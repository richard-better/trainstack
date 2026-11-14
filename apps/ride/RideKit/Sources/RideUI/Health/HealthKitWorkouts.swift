#if os(iOS)
  import CoreLocation
  import Foundation
  import HealthKit
  import RideData

  final class HealthKitWorkouts: HealthStore {
    static let readTypes: Set<HKObjectType> = [
      .workoutType(), HKSeriesType.workoutRoute(), HKQuantityType(.heartRate),
      HKQuantityType(.cyclingPower), HKQuantityType(.cyclingCadence),
      HKQuantityType(.cyclingSpeed), HKQuantityType(.runningPower),
      HKQuantityType(.runningSpeed), HKQuantityType(.distanceWalkingRunning),
      HKQuantityType(.distanceCycling), HKQuantityType(.distanceSwimming),
      HKQuantityType(.activeEnergyBurned), HKCategoryType(.sleepAnalysis),
      HKQuantityType(.restingHeartRate), HKQuantityType(.heartRateVariabilitySDNN),
    ]

    private let store: HKHealthStore
    private let appBundleIdentifier: String

    init(store: HKHealthStore = HKHealthStore(), appBundleIdentifier: String) {
      self.store = store
      self.appBundleIdentifier = appBundleIdentifier
    }

    func requestAccess() async throws {
      guard HKHealthStore.isHealthDataAvailable() else { return }
      try await store.requestAuthorization(toShare: [], read: Self.readTypes)
    }

    func observeWorkouts(_ changed: @escaping @Sendable () -> Void) {
      guard HKHealthStore.isHealthDataAvailable() else { return }
      store.execute(
        HKObserverQuery(sampleType: .workoutType(), predicate: nil) { _, completion, _ in
          changed()
          completion()
        })
    }

    func workouts() async throws -> [HealthWorkoutEntry] {
      guard HKHealthStore.isHealthDataAvailable() else { return [] }
      let query = HKSampleQueryDescriptor(predicates: [.workout()], sortDescriptors: [])
      return try await query.result(for: store).map { workout in
        HealthWorkoutEntry(
          id: workout.uuid.uuidString, endDate: workout.endDate,
          writtenByRide: HealthWorkoutEntry.isRide(
            workout.sourceRevision.source.bundleIdentifier,
            appBundleIdentifier: appBundleIdentifier))
      }
    }

    func activity(of id: String) async throws -> HealthActivity? {
      guard let uuid = UUID(uuidString: id) else { return nil }
      let query = HKSampleQueryDescriptor(
        predicates: [.workout(HKQuery.predicateForObject(with: uuid))], sortDescriptors: [],
        limit: 1)
      guard let workout = try await query.result(for: store).first else { return nil }
      return try await activity(of: workout)
    }

    func measuredDays(_ days: [SettingDay], calendar: Calendar) async throws -> [MeasuredDay] {
      guard HKHealthStore.isHealthDataAvailable(), let first = days.min(), let last = days.max()
      else { return [] }
      let from = calendar.date(byAdding: .day, value: -1, to: first.date(in: calendar))
      let through = calendar.date(byAdding: .day, value: 1, to: last.date(in: calendar))
      guard let from, let through else { return [] }
      let window = HKQuery.predicateForSamples(withStart: from, end: through)
      let asleepValues = HKCategoryValueSleepAnalysis.allAsleepValues.map(\.rawValue)
      let sleep = try await HKSampleQueryDescriptor(
        predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: window)],
        sortDescriptors: []
      ).result(for: store)
      let asleep = sleep.filter { asleepValues.contains($0.value) }.map {
        DateInterval(start: $0.startDate, end: max($0.startDate, $0.endDate))
      }
      let perMinute = HKUnit.count().unitDivided(by: .minute())
      let restingHeartRate = try await samples(of: HKQuantityType(.restingHeartRate), window)
        .map {
          HealthActivity.Reading(date: $0.startDate, value: $0.quantity.doubleValue(for: perMinute))
        }
      let hrv = try await samples(of: HKQuantityType(.heartRateVariabilitySDNN), window)
        .map {
          HealthActivity.Reading(
            date: $0.startDate, value: $0.quantity.doubleValue(for: .secondUnit(with: .milli)))
        }
      return MeasuredDay.days(
        days, asleep: asleep, restingHeartRate: restingHeartRate, hrv: hrv, calendar: calendar)
    }

    private func activity(of workout: HKWorkout) async throws -> HealthActivity {
      let metadata = workout.metadata ?? [:]
      let indoor = (metadata[HKMetadataKeyIndoorWorkout] as? Bool) ?? false
      let swimming =
        (metadata[HKMetadataKeySwimmingLocationType] as? NSNumber)
        .flatMap { HKWorkoutSwimmingLocationType(rawValue: $0.intValue) } ?? .unknown
      let perMinute = HKUnit.count().unitDivided(by: .minute())
      let metresPerSecond = HKUnit.meter().unitDivided(by: .second())
      let distanceType = Self.distanceType(of: workout.workoutActivityType)
      let distance = try await readings(distanceType, .meter(), during: workout)
      var soFar = 0.0
      let distanceSoFar = distance.map { reading in
        soFar += reading.value
        return HealthActivity.Reading(date: reading.end, value: soFar)
      }
      return HealthActivity(
        sport: HealthSport(workout.workoutActivityType, indoor: indoor, swimmingLocation: swimming),
        startDate: workout.startDate, endDate: workout.endDate,
        utcOffsetSeconds: (metadata[HKMetadataKeyTimeZone] as? String)
          .flatMap(TimeZone.init(identifier:))?.secondsFromGMT(for: workout.startDate),
        heartRate: try await readings(.heartRate, perMinute, during: workout).map(\.reading),
        power: try await readings(Self.powerType(of: workout), .watt(), during: workout)
          .map(\.reading),
        cadence: try await readings(.cyclingCadence, perMinute, during: workout).map(\.reading),
        speed: try await readings(Self.speedType(of: workout), metresPerSecond, during: workout)
          .map(\.reading),
        distanceSoFar: distanceSoFar,
        locations: try await locations(of: workout),
        pauses: Self.pauses(of: workout),
        totalDistanceMetres: workout.statistics(for: HKQuantityType(distanceType))?.sumQuantity()?
          .doubleValue(for: .meter()),
        activeKilocalories: workout.statistics(for: HKQuantityType(.activeEnergyBurned))?
          .sumQuantity()?.doubleValue(for: .kilocalorie()),
        ascentMetres: (metadata[HKMetadataKeyElevationAscended] as? HKQuantity)?
          .doubleValue(for: .meter()))
    }

    private struct Measured {
      let start: Date
      let end: Date
      let value: Double

      var reading: HealthActivity.Reading { .init(date: start, value: value) }
    }

    private func readings(
      _ identifier: HKQuantityTypeIdentifier, _ unit: HKUnit, during workout: HKWorkout
    ) async throws -> [Measured] {
      let type = HKQuantityType(identifier)
      let associated = try await samples(of: type, HKQuery.predicateForObjects(from: workout))
      let chosen: [HKQuantitySample]
      if associated.isEmpty {
        let during = try await samples(
          of: type,
          HKQuery.predicateForSamples(
            withStart: workout.startDate, end: workout.endDate,
            options: [.strictStartDate, .strictEndDate]))
        chosen = Self.oneSource(of: during, preferring: workout.sourceRevision.source)
      } else {
        chosen = associated
      }
      return
        chosen
        .map {
          Measured(start: $0.startDate, end: $0.endDate, value: $0.quantity.doubleValue(for: unit))
        }
        .sorted { ($0.start, $0.end, $0.value) < ($1.start, $1.end, $1.value) }
    }

    private func samples(of type: HKQuantityType, _ predicate: NSPredicate) async throws
      -> [HKQuantitySample]
    {
      try await HKSampleQueryDescriptor(
        predicates: [.quantitySample(type: type, predicate: predicate)], sortDescriptors: []
      ).result(for: store)
    }

    private static func oneSource(of samples: [HKQuantitySample], preferring preferred: HKSource)
      -> [HKQuantitySample]
    {
      let bySource = Dictionary(grouping: samples) { $0.sourceRevision.source.bundleIdentifier }
      if let own = bySource[preferred.bundleIdentifier] { return own }
      return bySource.max { a, b in
        (a.value.count, b.key) < (b.value.count, a.key)
      }?.value ?? []
    }

    private func locations(of workout: HKWorkout) async throws -> [HealthActivity.Location] {
      let routes = try await HKSampleQueryDescriptor(
        predicates: [.workoutRoute(HKQuery.predicateForObjects(from: workout))],
        sortDescriptors: []
      ).result(for: store)
      var locations: [HealthActivity.Location] = []
      for route in routes {
        for try await location in HKWorkoutRouteQueryDescriptor(route).results(for: store) {
          locations.append(
            .init(
              date: location.timestamp, latitude: location.coordinate.latitude,
              longitude: location.coordinate.longitude,
              altitudeMetres: location.verticalAccuracy >= 0 ? location.altitude : nil,
              speedMetresPerSecond: location.speed >= 0 ? location.speed : nil))
        }
      }
      return locations
    }

    private static func pauses(of workout: HKWorkout) -> [HealthActivity.Pause] {
      var pauses: [HealthActivity.Pause] = []
      var pausedAt: Date?
      let events = (workout.workoutEvents ?? []).sorted {
        $0.dateInterval.start < $1.dateInterval.start
      }
      for event in events {
        switch event.type {
        case .pause, .motionPaused:
          pausedAt = pausedAt ?? event.dateInterval.start
        case .resume, .motionResumed:
          if let from = pausedAt {
            pauses.append(.init(from: from, to: event.dateInterval.start))
            pausedAt = nil
          }
        default: break
        }
      }
      if let from = pausedAt { pauses.append(.init(from: from, to: workout.endDate)) }
      return pauses
    }

    private static func distanceType(of type: HKWorkoutActivityType) -> HKQuantityTypeIdentifier {
      switch type {
      case .cycling, .handCycling: .distanceCycling
      case .swimming: .distanceSwimming
      default: .distanceWalkingRunning
      }
    }

    private static func powerType(of workout: HKWorkout) -> HKQuantityTypeIdentifier {
      workout.workoutActivityType == .running ? .runningPower : .cyclingPower
    }

    private static func speedType(of workout: HKWorkout) -> HKQuantityTypeIdentifier {
      workout.workoutActivityType == .running ? .runningSpeed : .cyclingSpeed
    }
  }
#endif
