#if os(iOS)
  import HealthKit
  import Observation
  import RideBluetooth
  import RideLink
  import WatchConnectivity
  import os

  @Observable
  final class WatchLink {
    static let shared = WatchLink()

    private(set) var heartRate: Int?
    private(set) var isConnected = false
    @ObservationIgnored var onHeartRate: ((Int) -> Void)?
    @ObservationIgnored var isRecordingRide = false {
      didSet { claimRideForHealth() }
    }
    @ObservationIgnored private var isRelayingARideTheMacRecords = false
    @ObservationIgnored private let store = HKHealthStore()
    @ObservationIgnored private var session: HKWorkoutSession?
    @ObservationIgnored private var delegate: SessionDelegate?
    @ObservationIgnored private let relay = HeartRateRelay()
    @ObservationIgnored private let phoneWorkout = PhoneWorkout()
    @ObservationIgnored private let pairing = WatchPairing()
    @ObservationIgnored private let log = Logger(
      subsystem: "com.trainstackhq.ride", category: "watch")

    private init() {
      store.workoutSessionMirroringStartHandler = { [weak self] session in
        Task { @MainActor in self?.attach(session) }
      }
      Task { [phoneWorkout] in await phoneWorkout.endLeftOverSession() }
      relay.claim = { AppSync.shared.claim }
      relay.onRideRecorded = { [weak self] in
        self?.isRelayingARideTheMacRecords = true
        self?.claimRideForHealth()
      }
    }

    static func activateAtLaunch() { _ = shared }

    func startWorkout() {
      guard HKHealthStore.isHealthDataAvailable(), session == nil else { return }
      Task {
        await HealthRides.shared.requestAccessWhileInFront()
        guard session == nil else { return }
        guard pairing.hasWatchWithRideInstalled else {
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

    func endRide() {
      phoneWorkout.end()
      send(.rideEnded)
    }

    func sendGlance(_ glance: RideGlance) {
      send(.glance(glance))
      claimRideForHealth()
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
      claimRideForHealth()
    }

    private func claimRideForHealth() {
      guard isRecordingRide || isRelayingARideTheMacRecords, HealthRides.shared.canSave
      else { return }
      send(.rideRecorded)
    }

    private func detach(_ session: HKWorkoutSession) {
      guard session === self.session else { return }
      self.session = nil
      delegate = nil
      isRelayingARideTheMacRecords = false
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
      if isRelayingARideTheMacRecords { claimRideForHealth() }
    }
  }

  private final class WatchPairing: NSObject, WCSessionDelegate {
    override init() {
      super.init()
      guard WCSession.isSupported() else { return }
      WCSession.default.delegate = self
      WCSession.default.activate()
    }

    var hasWatchWithRideInstalled: Bool {
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
      session.activate()
    }
  }

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
