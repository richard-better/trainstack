#if os(iOS)
  import Foundation
  import HealthKit
  import RideLink
  import UIKit
  import os

  /// Saves rides to Health as workouts, on iPhone and iPad.
  ///
  /// A ride waits in a queue until it is saved, so one that cannot be saved yet, because Health
  /// is locked or the rider has not been asked for access, is saved once the app is next active.
  /// A ride Health already has a cycling workout for, from Ride or any other app, is skipped.
  final class HealthRides {
    static let shared = HealthRides()

    /// What Ride saves: the workout and its samples.
    static let savedTypes: Set<HKSampleType> = [
      .workoutType(), HKQuantityType(.activeEnergyBurned), HKQuantityType(.cyclingPower),
      HKQuantityType(.cyclingCadence), HKQuantityType(.heartRate),
    ]
    /// What Ride reads: workouts, to not save a ride twice, and heart rate from the watch.
    static let readTypes: Set<HKObjectType> = [.workoutType(), HKQuantityType(.heartRate)]

    private let store = HKHealthStore()
    private let defaults: UserDefaults
    private var pending: Set<Ride.ID> {
      didSet { defaults.set(Array(pending), forKey: Self.pendingKey) }
    }
    private var isSaving = false
    private let log = Logger(subsystem: "com.trainstackhq.ride", category: "health")
    private static let pendingKey = "healthPendingRides"

    init(defaults: UserDefaults = .standard) {
      self.defaults = defaults
      pending = Set(defaults.stringArray(forKey: Self.pendingKey) ?? [])
    }

    /// Whether the rider lets Ride save workouts to Health.
    var canSave: Bool {
      HKHealthStore.isHealthDataAvailable()
        && store.authorizationStatus(for: .workoutType()) == .sharingAuthorized
    }

    /// Asks the rider for access to Health, unless they have answered already. Only asks while
    /// the app is in front, where the request can show.
    func requestAccess() async {
      guard HKHealthStore.isHealthDataAvailable(),
        UIApplication.shared.applicationState == .active
      else { return }
      do {
        try await store.requestAuthorization(toShare: Self.savedTypes, read: Self.readTypes)
      } catch {
        log.error("Health access not requested: \(error.localizedDescription)")
      }
    }

    /// Saves the ride with `id` in `library` to Health, now or once it can. Sample rides and
    /// rides kept only in memory stay out of Health.
    func save(_ id: Ride.ID, from library: RideLibrary) {
      guard HKHealthStore.isHealthDataAvailable(), library.isStored else { return }
      pending.insert(id)
      Task { await savePending(from: library) }
    }

    /// Saves the rides waiting for Health.
    func savePending(from library: RideLibrary) async {
      guard HKHealthStore.isHealthDataAvailable(), library.isStored, !pending.isEmpty, !isSaving
      else { return }
      isSaving = true
      defer { isSaving = false }
      await requestAccess()
      switch store.authorizationStatus(for: .workoutType()) {
      case .notDetermined: return
      case .sharingDenied:
        pending.removeAll()
        return
      default: break
      }
      for id in pending {
        guard let ride = library[id] else {
          pending.remove(id)
          continue
        }
        do {
          let workout = HealthWorkout(ride)
          if try await !hasCyclingWorkout(from: workout.startDate, to: workout.endDate) {
            try await save(workout)
          }
          pending.remove(id)
        } catch {
          log.error("Ride not saved to Health: \(error.localizedDescription)")
        }
      }
    }

    private func hasCyclingWorkout(from start: Date, to end: Date) async throws -> Bool {
      let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
        HKQuery.predicateForSamples(withStart: start, end: end),
        HKQuery.predicateForWorkouts(with: .cycling),
      ])
      let query = HKSampleQueryDescriptor(
        predicates: [.workout(predicate)], sortDescriptors: [], limit: 1)
      return try await !query.result(for: store).isEmpty
    }

    private func save(_ workout: HealthWorkout) async throws {
      let builder = HKWorkoutBuilder(
        healthStore: store, configuration: WorkoutKind.configuration, device: nil)
      try await builder.beginCollection(at: workout.startDate)
      if !workout.samples.isEmpty { try await builder.addSamples(workout.samples) }
      try await builder.addMetadata(workout.metadata)
      try await builder.endCollection(at: workout.endDate)
      try await builder.finishWorkout()
    }
  }
#endif
