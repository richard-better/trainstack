import Foundation
import Observation
import RideBluetooth
import RideData
import RideLink

/// Runs a ride: moves the session on once a second with the latest reading.
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
  @ObservationIgnored private var simulator: SimulatedTrainer?
  @ObservationIgnored private var clock: Task<Void, Never>?

  /// With `simulated` a pretend trainer supplies the readings, for previews and debug builds.
  /// Real power and cadence come from the selected connected sensors in `devices`, and heart
  /// rate from `heartRate`. Live readings take precedence over the simulator.
  init(
    template: WorkoutTemplate, ftp: Int, heartRateZones: ZoneSet? = nil,
    heartRate: HeartRateFeed? = nil, devices: BluetoothDevices? = nil, simulated: Bool
  ) {
    self.template = template
    self.ftp = ftp
    self.heartRateZones = heartRateZones
    self.heartRate = heartRate
    self.devices = devices
    session = RideSession(workout: template.workout(ftp: ftp))
    simulator = simulated ? SimulatedTrainer() : nil
  }

  func start() {
    guard clock == nil else { return }
    clock = Task { [weak self] in
      var last = ContinuousClock.now
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(1))
        let now = ContinuousClock.now
        self?.tick(seconds: (now - last) / .seconds(1))
        last = now
      }
    }
  }

  func stop() {
    clock?.cancel()
    clock = nil
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
    session.advance(by: seconds, reading: reading)
    onTick?()
  }

  func togglePause() { session.togglePause() }
  func skipInterval() { session.skipInterval() }
  func adjust(by steps: Int) { session.adjust(by: steps) }

  var mode: TrainerMode {
    get { session.mode }
    set { session.mode = newValue }
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
