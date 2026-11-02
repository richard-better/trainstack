import Foundation
import Observation
import RideBluetooth
import RideCore
import RideData
import RideLink

@Observable
final class RideController {
  private(set) var engine: RideEngine
  var session: RideSession { engine.session }
  var pausedForTrainer: Bool { engine.isPausedForTrainer }
  let template: WorkoutTemplate
  let ftp: Int
  let heartRateZones: ZoneSet?
  var powerDisplay = PowerDisplay.standard
  private(set) var totals = RideTotals()
  @ObservationIgnored var onTick: (() -> Void)?
  @ObservationIgnored private let heartRate: HeartRateFeed?
  @ObservationIgnored private let devices: BluetoothDevices?
  @ObservationIgnored let journal: RideJournal?
  @ObservationIgnored private var simulator: SimulatedTrainer?
  @ObservationIgnored private var clock: Task<Void, Never>?
  @ObservationIgnored private var lastTick = ContinuousClock.now

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
    engine = RideEngine(session: session ?? RideSession(workout: template.workout(ftp: ftp)))
    simulator = simulated ? SimulatedTrainer() : nil
    apply(.begin(trainerConnected: isTrainerConnected == true))
  }

  init(
    resuming interrupted: InterruptedRide, heartRateZones: ZoneSet? = nil,
    heartRate: HeartRateFeed? = nil, devices: BluetoothDevices? = nil,
    journal: RideJournal? = nil, simulated: Bool
  ) {
    template = interrupted.trace.header.template
    ftp = interrupted.trace.header.ftp
    self.heartRateZones = heartRateZones
    self.heartRate = heartRate
    self.devices = devices
    self.journal = journal
    engine = interrupted.engine
    simulator = simulated ? SimulatedTrainer() : nil
    apply(.resumeAfterCrash(trainerConnected: isTrainerConnected == true))
  }

  private func apply(_ input: RideInput, at date: Date = .now) {
    journal?.append(input)
    let sample = engine.apply(input)
    if sample != nil || Self.changesTotalsWithoutASample(input) {
      totals = RideTotals(session: session, ftp: ftp)
    }
    updateTrainer(at: date)
  }

  private static func changesTotalsWithoutASample(_ input: RideInput) -> Bool {
    switch input {
    case .begin, .resumeAfterCrash, .skipInterval: true
    case .tick, .togglePause, .adjust, .changeMode: false
    }
  }

  isolated deinit { clock?.cancel() }

  @discardableResult
  func start() -> Task<Void, Never> {
    if let clock { return clock }
    updateTrainer()
    lastTick = .now
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

  func stop() {
    clock?.cancel()
    clock = nil
    devices?.onCyclingActivity = nil
    devices?.setTrainerTarget(nil)
  }

  func tickIfDue(at now: ContinuousClock.Instant = .now) {
    let seconds = (now - lastTick) / .seconds(1)
    guard seconds >= Self.minimumTick else { return }
    lastTick = now
    tick(seconds: seconds)
  }

  private static let minimumTick: TimeInterval = 0.9

  func tick(seconds: TimeInterval, at date: Date = .now) {
    var reading = simulator?.reading(for: session, after: seconds) ?? TrainerReading()
    if let power = devices?.reading(for: .power, at: date) { reading.power = power }
    if let cadence = devices?.reading(for: .cadence, at: date) { reading.cadence = cadence }
    if let live = heartRate?.current(at: date) {
      reading.heartRate = live.bpm
      reading.heartRateSource = live.source
    }
    apply(
      .tick(seconds: seconds, reading: reading, trainerConnected: isTrainerConnected == true),
      at: date)
    onTick?()
  }

  func togglePause() { apply(.togglePause) }

  var isTrainerConnected: Bool? {
    guard let devices, let trainer = devices.paired(.trainer) else { return nil }
    return devices.connectionState(of: trainer.id) == .connected
  }

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

  var hasSensors: Bool { devices != nil }

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

  func skipInterval() { apply(.skipInterval) }

  func adjust(by steps: Int) { apply(.adjust(steps: steps)) }

  var mode: TrainerMode {
    get { session.mode }
    set { apply(.changeMode(newValue)) }
  }

  var trainerTarget: TrainerTarget { engine.trainerTarget }

  private func updateTrainer(at date: Date = .now) {
    devices?.setTrainerTarget(trainerTarget, at: date)
  }

  var power: Int? { session.power(powerDisplay) }

  func zone(of interval: RideSession.Interval) -> PowerZone {
    PowerZone.zone(power: interval.plannedPower, ftp: ftp)
  }

  var heartRateZone: Zone? {
    guard let bpm = session.latest.heartRate else { return nil }
    return heartRateZones?.zone(containing: bpm)
  }

  var glance: RideGlance {
    RideGlance(
      session: session, ftp: ftp, heartRateZones: heartRateZones, powerDisplay: powerDisplay)
  }

  static func preview(
    _ template: WorkoutTemplate = .named("Recovery 30")!, ftp: Int = 200, minutes: Double = 16.5
  ) -> RideController {
    let controller = RideController(template: template, ftp: ftp, simulated: true)
    for _ in 0..<Int(minutes * 60) { controller.tick(seconds: 1) }
    return controller
  }
}
