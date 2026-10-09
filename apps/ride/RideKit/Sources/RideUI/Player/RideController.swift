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
  /// The zones the watch shows heart rate in.
  let heartRateZones: ZoneSet?
  /// Called after each second of the ride, to keep the watch up to date.
  @ObservationIgnored var onTick: (() -> Void)?
  @ObservationIgnored private let heartRate: HeartRateFeed?
  @ObservationIgnored private let devices: BluetoothDevices?
  /// Records the ride as it goes, so it survives a crash.
  @ObservationIgnored let journal: RideJournal?
  @ObservationIgnored private var simulator: SimulatedTrainer?
  @ObservationIgnored private var clock: Task<Void, Never>?

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
  }

  isolated deinit { clock?.cancel() }

  @discardableResult
  func start() -> Task<Void, Never> {
    if let clock { return clock }
    updateTrainer()
    let clock = Task { [weak self] in
      var last = ContinuousClock.now
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(1)) } catch { break }
        guard !Task.isCancelled, self != nil else { break }
        let now = ContinuousClock.now
        self?.tick(seconds: (now - last) / .seconds(1))
        last = now
      }
    }
    self.clock = clock
    return clock
  }

  /// Ends the ride and hands the trainer back.
  func stop() {
    clock?.cancel()
    clock = nil
    devices?.setTrainerTarget(nil)
  }

  /// Moves the ride on by `seconds`, as the clock does each second.
  func tick(seconds: TimeInterval, at date: Date = .now) {
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

  func togglePause() { session.togglePause() }

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

  func zone(of interval: RideSession.Interval) -> PowerZone {
    PowerZone.zone(power: interval.plannedPower, ftp: ftp)
  }

  /// The ride as the watch shows it.
  var glance: RideGlance {
    RideGlance(session: session, ftp: ftp, heartRateZones: heartRateZones)
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
