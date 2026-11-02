import Foundation
import Observation
import RideLink
import os

#if os(watchOS)
  import HealthKit
  import WatchKit
#endif

@Observable
public final class WorkoutRelay {
  public static let shared = WorkoutRelay()

  private(set) var workout: WatchWorkout?
  private(set) var measuredHeartRate: Int?
  private(set) var glance: ReceivedGlance?
  private(set) var isPhoneConnected = false
  @ObservationIgnored var playCue: @MainActor (IntervalCue) -> Void = WorkoutRelay.tapTheWrist
  @ObservationIgnored private var countdown = IntervalCountdown()
  @ObservationIgnored private let log = Logger(
    subsystem: "com.trainstackhq.ride", category: "watch")
  #if os(watchOS)
    @ObservationIgnored private let store = HKHealthStore()
    @ObservationIgnored private var slot = WorkoutSessionSlot<HKWorkoutSession>()
    @ObservationIgnored private var builder: HKLiveWorkoutBuilder?
    @ObservationIgnored private var delegate: MainActorWorkoutDelegate?
    @ObservationIgnored private var startup: Task<Void, Never>?
    @ObservationIgnored private var phoneWatchdog: Task<Void, Never>?
    @ObservationIgnored private let defaults = UserDefaults.standard
    private static let startedOnPhoneKey = "workoutStartedOnPhone"
    private static let phoneWatchdogInterval = Duration.seconds(30)
  #endif

  init() {}

  func receive(_ message: LinkMessage, at date: Date = .now) {
    switch message {
    case .glance(let glance):
      self.glance = ReceivedGlance(glance: glance, receivedAt: date)
      workout?.lastHeardFromPhone = date
      if let cue = countdown.update(glance.interval, isPaused: glance.isPaused) { playCue(cue) }
    case .rideEnded:
      end()
    case .rideRecorded:
      workout?.isRecordedElsewhere = true
      #if os(watchOS)
        stopCollectingEnergyTheRecordingAlreadyHas()
      #endif
    case .heartRate:
      break
    }
  }

  private static func tapTheWrist(_ cue: IntervalCue) {
    #if os(watchOS)
      switch cue {
      case .warning: WKInterfaceDevice.current().play(.notification)
      case .secondsLeft: WKInterfaceDevice.current().play(.start)
      }
    #endif
  }

  #if DEBUG
    func simulateWorkout() {
      workout = WatchWorkout(startDate: .now, startedOnPhone: true)
      isPhoneConnected = true
    }

    func simulateHeartRate(_ bpm: Int?) { measuredHeartRate = bpm }
  #endif

  private func reset() {
    workout = nil
    measuredHeartRate = nil
    glance = nil
    isPhoneConnected = false
    countdown = IntervalCountdown()
  }

  #if os(watchOS)
    func requestAuthorizationBeforeTheFirstRide() async {
      do {
        try await store.requestAuthorization(
          toShare: [HKObjectType.workoutType()],
          read: [HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned)])
      } catch {
        log.error("Health authorization failed: \(error.localizedDescription)")
      }
    }

    public func start(fromPhone: Bool) {
      guard slot.isEmpty else { return }
      do {
        let configuration = WorkoutKind.configuration
        let session = try HKWorkoutSession(healthStore: store, configuration: configuration)
        let builder = session.associatedWorkoutBuilder()
        builder.dataSource = HKLiveWorkoutDataSource(
          healthStore: store, workoutConfiguration: configuration)
        guard attach(session, builder: builder) else { return }
        let startDate = Date.now
        workout = WatchWorkout(startDate: startDate, startedOnPhone: fromPhone)
        defaults.set(fromPhone, forKey: Self.startedOnPhoneKey)
        watchForASilentPhone(session)
        session.startActivity(with: startDate)
        startup = Task {
          do {
            try await builder.beginCollection(at: startDate)
            guard !Task.isCancelled, slot.holds(session) else { return }
            await mirror(session)
          } catch {
            guard !Task.isCancelled, slot.holds(session) else { return }
            log.error("Workout collection did not begin: \(error.localizedDescription)")
            session.end()
          }
        }
      } catch {
        log.error("Workout did not start: \(error.localizedDescription)")
      }
    }

    func recover() async {
      guard slot.isEmpty else { return }
      do {
        let recovered = try await store.recoverActiveWorkoutSession()
        guard let session = recovered,
          attach(session, builder: session.associatedWorkoutBuilder())
        else { return }
        workout = WatchWorkout(
          startDate: session.startDate ?? .now,
          startedOnPhone: defaults.bool(forKey: Self.startedOnPhoneKey), lastHeardFromPhone: .now)
        watchForASilentPhone(session)
        await mirror(session)
      } catch {
        log.error("Workout not recovered: \(error.localizedDescription)")
      }
    }

    public func end() {
      if let session = slot.session {
        session.end()
      } else {
        reset()
      }
    }

    private func attach(_ session: HKWorkoutSession, builder: HKLiveWorkoutBuilder) -> Bool {
      guard slot.take(session) else { return false }
      let delegate = MainActorWorkoutDelegate(
        heartRate: { [weak self, weak session] bpm in
          guard let self, slot.holds(session) else { return }
          measured(bpm)
        },
        receive: { [weak self, weak session] data in
          guard let self, slot.holds(session) else { return }
          for message in data.compactMap({ try? LinkMessage(data: $0) }) { receive(message) }
        },
        disconnect: { [weak self, weak session] in
          guard let self, slot.holds(session) else { return }
          isPhoneConnected = false
        },
        end: { [weak self, weak session] date in
          guard let self, slot.holds(session) else { return }
          finish(at: date)
        })
      session.delegate = delegate
      builder.delegate = delegate
      self.builder = builder
      self.delegate = delegate
      return true
    }

    private func watchForASilentPhone(_ session: HKWorkoutSession) {
      phoneWatchdog?.cancel()
      phoneWatchdog = Task { [weak self, weak session] in
        while !Task.isCancelled {
          do { try await Task.sleep(for: Self.phoneWatchdogInterval) } catch { return }
          guard let self, let session, slot.holds(session), let workout else { return }
          if workout.hasLostThePhone(at: .now) {
            log.info("Ending a workout the phone stopped sending to")
            session.end()
            return
          }
        }
      }
    }

    private func stopCollectingEnergyTheRecordingAlreadyHas() {
      builder?.dataSource?.disableCollection(for: HKQuantityType(.activeEnergyBurned))
    }

    private func mirror(_ session: HKWorkoutSession) async {
      do {
        try await session.startMirroringToCompanionDevice()
        guard slot.holds(session) else { return }
        isPhoneConnected = true
      } catch {
        log.error("Workout not mirrored to iPhone: \(error.localizedDescription)")
      }
    }

    private func measured(_ bpm: Int) {
      measuredHeartRate = bpm
      guard isPhoneConnected, let session = slot.session,
        let data = try? LinkMessage.heartRate(bpm).encoded()
      else { return }
      Task {
        do {
          try await session.sendToRemoteWorkoutSession(data: data)
        } catch {
          log.debug("Heart rate not sent: \(error.localizedDescription)")
        }
      }
    }

    private func finish(at date: Date) {
      guard let builder else { return }
      let savesToHealth = workout?.savesToHealthItself ?? true
      let startup = self.startup
      self.startup = nil
      startup?.cancel()
      phoneWatchdog?.cancel()
      phoneWatchdog = nil
      defaults.removeObject(forKey: Self.startedOnPhoneKey)
      slot.empty()
      self.builder = nil
      delegate = nil
      reset()
      Task {
        await startup?.value
        guard savesToHealth else {
          builder.discardWorkout()
          return
        }
        do {
          try await builder.endCollection(at: date)
          try await builder.finishWorkout()
        } catch {
          log.error("Workout not saved: \(error.localizedDescription)")
        }
      }
    }
  #else
    public func start(fromPhone: Bool) {
      workout = WatchWorkout(startDate: .now, startedOnPhone: fromPhone)
    }

    public func end() { reset() }
  #endif
}

#if os(watchOS)
  private final class MainActorWorkoutDelegate: NSObject, HKWorkoutSessionDelegate,
    HKLiveWorkoutBuilderDelegate
  {
    private let heartRate: @MainActor (Int) -> Void
    private let receive: @MainActor ([Data]) -> Void
    private let disconnect: @MainActor () -> Void
    private let end: @MainActor (Date) -> Void

    init(
      heartRate: @escaping @MainActor (Int) -> Void,
      receive: @escaping @MainActor ([Data]) -> Void,
      disconnect: @escaping @MainActor () -> Void,
      end: @escaping @MainActor (Date) -> Void
    ) {
      self.heartRate = heartRate
      self.receive = receive
      self.disconnect = disconnect
      self.end = end
    }

    nonisolated func workoutSession(
      _ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
      from fromState: HKWorkoutSessionState, date: Date
    ) {
      guard toState == .ended else { return }
      Task { @MainActor in end(date) }
    }

    nonisolated func workoutSession(
      _ workoutSession: HKWorkoutSession, didFailWithError error: any Error
    ) {
      Task { @MainActor in end(.now) }
    }

    nonisolated func workoutSession(
      _ workoutSession: HKWorkoutSession, didReceiveDataFromRemoteWorkoutSession data: [Data]
    ) {
      Task { @MainActor in receive(data) }
    }

    nonisolated func workoutSession(
      _ workoutSession: HKWorkoutSession, didDisconnectFromRemoteDeviceWithError error: (any Error)?
    ) {
      Task { @MainActor in disconnect() }
    }

    nonisolated func workoutBuilder(
      _ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>
    ) {
      let type = HKQuantityType(.heartRate)
      guard collectedTypes.contains(type),
        let quantity = workoutBuilder.statistics(for: type)?.mostRecentQuantity()
      else { return }
      let bpm = Int(quantity.doubleValue(for: .count().unitDivided(by: .minute())).rounded())
      Task { @MainActor in heartRate(bpm) }
    }

    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
  }
#endif
