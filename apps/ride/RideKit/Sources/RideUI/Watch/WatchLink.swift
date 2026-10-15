#if os(iOS)
  import HealthKit
  import Observation
  import RideBluetooth
  import RideLink
  import WatchConnectivity
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
    /// Whether this phone is recording a ride, which it saves to Health in place of the watch's
    /// workout when it can.
    @ObservationIgnored var isRecordingRide = false {
      didSet { claimRide() }
    }
    @ObservationIgnored private let store = HKHealthStore()
    @ObservationIgnored private var session: HKWorkoutSession?
    @ObservationIgnored private var delegate: SessionDelegate?
    @ObservationIgnored private let relay = HeartRateRelay()
    @ObservationIgnored private let phoneWorkout = PhoneWorkout()
    /// Says whether there is a watch with Ride on it.
    @ObservationIgnored private let pairing = WatchPairing()
    @ObservationIgnored private let log = Logger(
      subsystem: "com.trainstackhq.ride", category: "watch")

    private init() {
      // Set at launch, since HealthKit may launch the app in the background just to hand over a
      // session the rider started on the watch.
      store.workoutSessionMirroringStartHandler = { [weak self] session in
        Task { @MainActor in self?.attach(session) }
      }
      Task { [phoneWorkout] in await phoneWorkout.endLeftOverSession() }
      relay.onRideRecorded = { [weak self] in
        // Ride on a Mac records the ride, and this phone saves it to Health once it syncs.
        guard HealthRides.shared.canSave else { return }
        self?.send(.rideRecorded)
      }
    }

    /// Makes sure the link is listening for the watch. See `WatchSupport.activate()`.
    static func activate() { _ = shared }

    /// Asks for access to Health, then opens Ride on the watch and starts its workout, unless
    /// one is already running. Without a watch, the phone runs the workout session itself.
    func startWorkout() {
      guard HKHealthStore.isHealthDataAvailable(), session == nil else { return }
      Task {
        await HealthRides.shared.requestAccess()
        guard session == nil else { return }
        guard pairing.hasRide else {
          phoneWorkout.start()
          return
        }
        do {
          try await store.startWatchApp(toHandle: WorkoutKind.configuration)
        } catch {
          log.info("Watch workout not started: \(error.localizedDescription)")
          phoneWorkout.start()
        }
      }
    }

    /// Ends the phone's workout session, and tells the watch the ride is over, which ends its
    /// workout.
    func endRide() {
      phoneWorkout.end()
      send(.rideEnded)
    }

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
        receive: { [weak self, weak session] data in
          guard let self, let session, self.session === session else { return }
          receive(data)
        },
        end: { [weak self, weak session] in
          if let session { self?.detach(session) }
        })
      session.delegate = delegate
      self.session = session
      self.delegate = delegate
      isConnected = true
      relay.start()
      claimRide()
    }

    /// Tells the watch this phone saves the ride to Health, so the watch does not save its
    /// workout too.
    private func claimRide() {
      guard isRecordingRide, HealthRides.shared.canSave else { return }
      send(.rideRecorded)
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

  /// Whether a paired watch has Ride installed, from WatchConnectivity.
  private final class WatchPairing: NSObject, WCSessionDelegate {
    override init() {
      super.init()
      guard WCSession.isSupported() else { return }
      WCSession.default.delegate = self
      WCSession.default.activate()
    }

    var hasRide: Bool {
      guard WCSession.isSupported() else { return false }
      let session = WCSession.default
      return session.activationState == .activated && session.isPaired
        && session.isWatchAppInstalled
    }

    nonisolated func session(
      _ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState,
      error: (any Error)?
    ) {}

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
      // A rider switching watches gets the new one.
      session.activate()
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
