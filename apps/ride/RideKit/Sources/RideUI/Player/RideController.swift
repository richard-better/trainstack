import Foundation
import Observation
import RideBluetooth
import RideData
import RideLink

/// Runs a ride: moves the session on once a second with the latest reading, and keeps the
/// trainer on the current mode's setting.
@Observable
final class RideController {
  private(set) var session: RideSession
  let template: WorkoutTemplate
  let ftp: Int
  /// The zones the player and the watch show heart rate in.
  let heartRateZones: ZoneSet?
  /// How power is shown, here and on the watch.
  var powerDisplay = PowerDisplay.standard
  /// Called after each second of the ride, to keep the watch up to date.
  @ObservationIgnored var onTick: (() -> Void)?
  @ObservationIgnored private let heartRate: HeartRateFeed?
  @ObservationIgnored private let devices: BluetoothDevices?
  /// Records the ride as it goes, so it survives a crash.
  @ObservationIgnored let journal: RideJournal?
  @ObservationIgnored private var simulator: SimulatedTrainer?
  @ObservationIgnored private var clock: Task<Void, Never>?
  @ObservationIgnored private var lastTick = ContinuousClock.now
  @ObservationIgnored private var trainerWasConnected = false

  /// With `simulated` a pretend trainer supplies the readings, for previews and debug builds.
  /// Real power and cadence come from the selected connected sensors in `devices`, and heart
  /// rate from `heartRate`. Live readings take precedence over the simulator.
  ///
  /// A ride starts afresh unless given the `session` of one to carry on.
  init(
    template: WorkoutTemplate, ftp: Int, heartRateZones: ZoneSet? = nil,
    heartRate: HeartRateFeed? = nil, devices: BluetoothDevices? = nil,
    session: RideSession? = nil, journal: RideJournal? = nil, simulated: Bool
  ) {
    self.template = template
    self.ftp = ftp
    self.heartRateZones = heartRateZones
    self.heartRate = heartRate
    self.devices = devices
    self.journal = journal
    self.session = session ?? RideSession(workout: template.workout(ftp: ftp))
    simulator = simulated ? SimulatedTrainer() : nil
    trainerWasConnected = isTrainerConnected == true
  }

  isolated deinit { clock?.cancel() }

  @discardableResult
  func start() -> Task<Void, Never> {
    if let clock { return clock }
    updateTrainer()
    lastTick = .now
    // While the app is in the background its timers stop, but the trainer still wakes it a
    // few times a second, so those measurements move the ride on as well.
    devices?.onCyclingActivity = { [weak self] in self?.tickIfDue() }
    let clock = Task { [weak self] in
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(1)) } catch { break }
        guard !Task.isCancelled, let self else { break }
        tickIfDue()
      }
    }
    self.clock = clock
    return clock
  }

  /// Ends the ride and hands the trainer back.
  func stop() {
    clock?.cancel()
    clock = nil
    devices?.onCyclingActivity = nil
    devices?.setTrainerTarget(nil)
  }

  /// Moves the ride on by the time since the last tick, unless that is under a second.
  func tickIfDue(at now: ContinuousClock.Instant = .now) {
    let seconds = (now - lastTick) / .seconds(1)
    guard seconds >= Self.minimumTick else { return }
    lastTick = now
    tick(seconds: seconds)
  }

  /// Just under a second, so a tick that comes a hair early is not skipped.
  private static let minimumTick: TimeInterval = 0.9

  /// Moves the ride on by `seconds`, as the clock does each second.
  func tick(seconds: TimeInterval, at date: Date = .now) {
    pauseIfTrainerDropped()
    var reading = simulator?.reading(for: session, after: seconds) ?? TrainerReading()
    if let power = devices?.reading(for: .power, at: date) { reading.power = power }
    if let cadence = devices?.reading(for: .cadence, at: date) { reading.cadence = cadence }
    if let live = heartRate?.current(at: date) {
      reading.heartRate = live.bpm
      reading.heartRateSource = live.source
    }
    let recorded = session.samples.count
    session.advance(by: seconds, reading: reading)
    journal?.append(
      .init(
        state: session.state, sample: session.samples.count > recorded ? session.samples.last : nil)
    )
    updateTrainer(at: date)
    onTick?()
  }

  func togglePause() {
    pausedForTrainer = false
    session.togglePause()
  }

  /// Whether the ride is paused because the trainer disconnected, until the rider resumes it.
  /// It does not resume by itself, since the trainer would jump straight to the target power.
  private(set) var pausedForTrainer = false

  /// Whether the rider's trainer is connected, or nil if they have not paired one.
  var isTrainerConnected: Bool? {
    guard let devices, let trainer = devices.paired(.trainer) else { return nil }
    return devices.connectionState(of: trainer.id) == .connected
  }

  /// What to tell the rider while the trainer is not as it should be, or nil if it is fine.
  var trainerNotice: String? {
    guard let name = devices?.paired(.trainer)?.displayName, let connected = isTrainerConnected
    else { return nil }
    switch (connected, pausedForTrainer) {
    case (false, true): return "\(name) disconnected, so the ride is paused. Reconnecting…"
    case (false, false): return "\(name) is not connected. Reconnecting…"
    case (true, true): return "\(name) is back. Resume when you are ready."
    case (true, false): return nil
    }
  }

  /// Whether the ride takes readings from the rider's devices, so has their status to show.
  var hasSensors: Bool { devices != nil }

  /// The rider's paired devices and the watch, and whether each is sending. The watch counts
  /// once it has sent heart rate during this ride.
  func sensorStatuses(at date: Date = .now) -> [SensorStatus] {
    let paired =
      devices.map { devices in
        devices.paired.map {
          SensorStatus.Device(
            device: $0, connection: devices.connectionState(of: $0.id),
            lastHeard: devices.lastHeard(from: $0.id), batteryLevel: devices.batteryLevel(of: $0.id)
          )
        }
      } ?? []
    let watch = heartRate?.latest(from: .watch).map(\.date).flatMap {
      $0 >= session.startDate ? $0 : nil
    }
    return SensorStatus.all(paired: paired, watchLastHeard: watch, at: date)
  }

  /// Pauses the ride when a trainer that was connected is not any more, so the workout does not
  /// carry on without anything holding the resistance.
  private func pauseIfTrainerDropped() {
    let connected = isTrainerConnected == true
    defer { trainerWasConnected = connected }
    guard trainerWasConnected, !connected, !session.isPaused else { return }
    session.pause()
    pausedForTrainer = true
  }

  func skipInterval() {
    session.skipInterval()
    updateTrainer()
  }

  func adjust(by steps: Int) {
    session.adjust(by: steps)
    updateTrainer()
  }

  var mode: TrainerMode {
    get { session.mode }
    set {
      session.mode = newValue
      updateTrainer()
    }
  }

  /// What the trainer is asked for: the current mode's setting, or a flat road once the
  /// workout is over.
  var trainerTarget: TrainerTarget {
    switch session.mode {
    case .erg: session.targetPower.map(TrainerTarget.power) ?? .grade(0)
    case .slope: .grade(session.grade)
    case .level: .resistance(Double(session.level) / Double(RideSession.levelRange.upperBound))
    }
  }

  /// Sends the trainer its target. Calling this each second also retries what the trainer
  /// left unanswered.
  private func updateTrainer(at date: Date = .now) {
    devices?.setTrainerTarget(trainerTarget, at: date)
  }

  /// Power as the rider chose to see it.
  var power: Int? { session.power(powerDisplay) }

  func zone(of interval: RideSession.Interval) -> PowerZone {
    PowerZone.zone(power: interval.plannedPower, ftp: ftp)
  }

  /// The zone the latest heart rate is in, or nil without heart rate or without zones.
  var heartRateZone: Zone? {
    guard let bpm = session.latest.heartRate else { return nil }
    return heartRateZones?.zone(containing: bpm)
  }

  /// The ride as the watch shows it.
  var glance: RideGlance {
    RideGlance(
      session: session, ftp: ftp, heartRateZones: heartRateZones, powerDisplay: powerDisplay)
  }

  /// A controller part way through `template`, for previews.
  static func preview(
    _ template: WorkoutTemplate = .named("Recovery 30")!, ftp: Int = 200, minutes: Double = 16.5
  ) -> RideController {
    let controller = RideController(template: template, ftp: ftp, simulated: true)
    for _ in 0..<Int(minutes * 60) { controller.tick(seconds: 1) }
    return controller
  }
}
