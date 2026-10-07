#if os(iOS)
  import HealthKit
  import Observation
  import RideBluetooth
  import RideLink
  import os

  /// The iPhone's end of the Apple Watch workout: the watch measures heart rate in a workout
  /// session it mirrors to the phone, and the phone sends back the ride to show.
  ///
  /// Starting a ride opens Ride on the watch, which starts the session. The rider can also start
  /// one on the watch to ride on a Mac; HealthKit then wakes the phone in the background, which
  /// passes the heart rate on over Bluetooth for the Mac to use like a chest strap.
  @Observable
  final class WatchLink {
    static let shared = WatchLink()

    /// The latest heart rate from the watch, while its workout runs.
    private(set) var heartRate: Int?
    private(set) var isConnected = false
    /// Called with each heart rate the watch sends.
    @ObservationIgnored var onHeartRate: ((Int) -> Void)?
    @ObservationIgnored private let store = HKHealthStore()
    @ObservationIgnored private var session: HKWorkoutSession?
    @ObservationIgnored private var delegate: SessionDelegate?
    @ObservationIgnored private let relay = HeartRateRelay()
    @ObservationIgnored private let log = Logger(
      subsystem: "com.trainstackhq.ride", category: "watch")

    private init() {
      // Set at launch, since HealthKit may launch the app in the background just to hand over a
      // session the rider started on the watch.
      store.workoutSessionMirroringStartHandler = { [weak self] session in
        Task { @MainActor in self?.attach(session) }
      }
    }

    /// Makes sure the link is listening for the watch. Call as the app launches.
    static func activate() { _ = shared }

    /// Opens Ride on the watch and starts its workout, unless one is already running.
    func startWorkout() {
      guard HKHealthStore.isHealthDataAvailable(), session == nil else { return }
      Task {
        do {
          try await store.requestAuthorization(
            toShare: [HKObjectType.workoutType()], read: [HKQuantityType(.heartRate)])
          try await store.startWatchApp(toHandle: WorkoutKind.configuration)
        } catch {
          // No paired watch, or no Ride on it.
          log.info("Watch workout not started: \(error.localizedDescription)")
        }
      }
    }

    /// Tells the watch the ride is over, which ends its workout and saves it to Health.
    func endRide() { send(.rideEnded) }

    func send(_ message: LinkMessage) {
      guard let session, let data = try? message.encoded() else { return }
      Task {
        do {
          try await session.sendToRemoteWorkoutSession(data: data)
        } catch {
          log.debug("Message to watch not sent: \(error.localizedDescription)")
        }
      }
    }

    private func attach(_ session: HKWorkoutSession) {
      let delegate = SessionDelegate(
        receive: { [weak self] data in self?.receive(data) },
        end: { [weak self, weak session] in
          if let session { self?.detach(session) }
        })
      session.delegate = delegate
      self.session = session
      self.delegate = delegate
      isConnected = true
      relay.start()
    }

    private func detach(_ session: HKWorkoutSession) {
      guard session === self.session else { return }
      self.session = nil
      delegate = nil
      isConnected = false
      heartRate = nil
      relay.stop()
    }

    private func receive(_ data: [Data]) {
      for case .heartRate(let bpm) in data.compactMap({ try? LinkMessage(data: $0) }) {
        heartRate = bpm
        onHeartRate?(bpm)
        relay.send(bpm: bpm)
      }
    }
  }

  /// Hands the mirrored session's callbacks, which arrive on HealthKit's queue, to the main
  /// actor.
  private final class SessionDelegate: NSObject, HKWorkoutSessionDelegate {
    private let receive: @MainActor ([Data]) -> Void
    private let end: @MainActor () -> Void

    init(receive: @escaping @MainActor ([Data]) -> Void, end: @escaping @MainActor () -> Void) {
      self.receive = receive
      self.end = end
    }

    nonisolated func workoutSession(
      _ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
      from fromState: HKWorkoutSessionState, date: Date
    ) {
      guard toState == .ended || toState == .stopped else { return }
      Task { @MainActor in end() }
    }

    nonisolated func workoutSession(
      _ workoutSession: HKWorkoutSession, didFailWithError error: any Error
    ) {
      Task { @MainActor in end() }
    }

    nonisolated func workoutSession(
      _ workoutSession: HKWorkoutSession, didReceiveDataFromRemoteWorkoutSession data: [Data]
    ) {
      Task { @MainActor in receive(data) }
    }

    nonisolated func workoutSession(
      _ workoutSession: HKWorkoutSession, didDisconnectFromRemoteDeviceWithError error: (any Error)?
    ) {
      Task { @MainActor in end() }
    }
  }
#endif
