import Foundation
import Observation
import RideLink
import os

#if os(watchOS)
  import HealthKit
  import WatchKit
#endif

/// The watch's workout: it measures heart rate, sends it to the phone, and shows the ride the
/// phone sends back. The workout is saved to Health as an indoor ride when it ends.
@Observable
public final class WorkoutRelay {
  public static let shared = WorkoutRelay()

  private(set) var workout: WatchWorkout?
  /// The latest heart rate the watch measured.
  private(set) var heartRate: Int?
  private(set) var glance: ReceivedGlance?
  /// Whether the workout reaches the phone.
  private(set) var isPhoneConnected = false
  /// Plays a cue as an interval ends. Set by default to tap the wrist.
  @ObservationIgnored var onCue: @MainActor (IntervalCue) -> Void = WorkoutRelay.tap
  @ObservationIgnored private var countdown = IntervalCountdown()
  @ObservationIgnored private let log = Logger(
    subsystem: "com.trainstackhq.ride", category: "watch")
  #if os(watchOS)
    @ObservationIgnored private let store = HKHealthStore()
    @ObservationIgnored private var session: HKWorkoutSession?
    @ObservationIgnored private var builder: HKLiveWorkoutBuilder?
    @ObservationIgnored private var delegate: WorkoutDelegate?
  #endif

  init() {}

  /// Takes in what the phone sent.
  func receive(_ message: LinkMessage, at date: Date = .now) {
    switch message {
    case .glance(let glance):
      self.glance = ReceivedGlance(glance: glance, date: date)
      if let cue = countdown.update(glance.interval, isPaused: glance.isPaused) { onCue(cue) }
    case .rideEnded:
      end()
    case .heartRate:
      break
    }
  }

  private static func tap(_ cue: IntervalCue) {
    #if os(watchOS)
      switch cue {
      case .warning: WKInterfaceDevice.current().play(.notification)
      case .count: WKInterfaceDevice.current().play(.start)
      }
    #endif
  }

  #if DEBUG
    /// A workout with no session behind it, for a ride played in a debug build.
    func simulateWorkout() {
      workout = WatchWorkout(startDate: .now, startedOnPhone: true)
      isPhoneConnected = true
    }

    func simulateHeartRate(_ bpm: Int?) { heartRate = bpm }
  #endif

  private func reset() {
    workout = nil
    heartRate = nil
    glance = nil
    isPhoneConnected = false
    countdown = IntervalCountdown()
  }

  #if os(watchOS)
    /// Asks to save workouts and read heart rate, so the first ride the phone starts needs no
    /// answer on the wrist.
    func requestAuthorization() async {
      do {
        try await store.requestAuthorization(
          toShare: [HKObjectType.workoutType()],
          read: [HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned)])
      } catch {
        log.error("Health authorization failed: \(error.localizedDescription)")
      }
    }

    /// Starts the workout, unless one is running. `fromPhone` when starting a ride on the
    /// phone opened the app.
    public func start(fromPhone: Bool) {
      guard session == nil else { return }
      do {
        let configuration = WorkoutKind.configuration
        let session = try HKWorkoutSession(healthStore: store, configuration: configuration)
        let builder = session.associatedWorkoutBuilder()
        builder.dataSource = HKLiveWorkoutDataSource(
          healthStore: store, workoutConfiguration: configuration)
        attach(session, builder: builder)
        let startDate = Date.now
        workout = WatchWorkout(startDate: startDate, startedOnPhone: fromPhone)
        session.startActivity(with: startDate)
        Task {
          await mirror(session)
          do {
            try await builder.beginCollection(at: startDate)
          } catch {
            log.error("Workout collection did not begin: \(error.localizedDescription)")
          }
        }
      } catch {
        log.error("Workout did not start: \(error.localizedDescription)")
      }
    }

    /// Picks up a workout that was running when the app quit.
    func recover() async {
      guard session == nil else { return }
      do {
        let session = try await store.recoverActiveWorkoutSession()
        guard let session else { return }
        attach(session, builder: session.associatedWorkoutBuilder())
        workout = WatchWorkout(startDate: session.startDate ?? .now, startedOnPhone: false)
        await mirror(session)
      } catch {
        log.error("Workout not recovered: \(error.localizedDescription)")
      }
    }

    /// Ends the workout. It is saved to Health once the session has stopped.
    public func end() {
      if let session {
        session.end()
      } else {
        reset()
      }
    }

    private func attach(_ session: HKWorkoutSession, builder: HKLiveWorkoutBuilder) {
      let delegate = WorkoutDelegate(
        heartRate: { [weak self] bpm in self?.measured(bpm) },
        receive: { [weak self] data in
          for message in data.compactMap({ try? LinkMessage(data: $0) }) { self?.receive(message) }
        },
        disconnect: { [weak self] in self?.isPhoneConnected = false },
        end: { [weak self] date in self?.finish(at: date) })
      session.delegate = delegate
      builder.delegate = delegate
      self.session = session
      self.builder = builder
      self.delegate = delegate
    }

    private func mirror(_ session: HKWorkoutSession) async {
      do {
        try await session.startMirroringToCompanionDevice()
        isPhoneConnected = true
      } catch {
        log.error("Workout not mirrored to iPhone: \(error.localizedDescription)")
      }
    }

    private func measured(_ bpm: Int) {
      heartRate = bpm
      guard isPhoneConnected, let session, let data = try? LinkMessage.heartRate(bpm).encoded()
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
      session = nil
      self.builder = nil
      delegate = nil
      reset()
      Task {
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
  /// Hands the session's and builder's callbacks, which arrive on HealthKit's queues, to the
  /// main actor.
  private final class WorkoutDelegate: NSObject, HKWorkoutSessionDelegate,
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
