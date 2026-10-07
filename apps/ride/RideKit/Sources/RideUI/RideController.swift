import Foundation
import Observation
import RideData

/// Runs a ride: moves the session on once a second with the latest reading.
@Observable
final class RideController {
  private(set) var session: RideSession
  let template: WorkoutTemplate
  let ftp: Int
  @ObservationIgnored private var simulator: SimulatedTrainer?
  @ObservationIgnored private var clock: Task<Void, Never>?

  /// With `simulated` a pretend trainer supplies the readings, for previews and debug builds.
  /// Without it readings are empty until trainers can be connected.
  init(template: WorkoutTemplate, ftp: Int, simulated: Bool) {
    self.template = template
    self.ftp = ftp
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
  func tick(seconds: TimeInterval) {
    let reading = simulator?.reading(for: session, after: seconds) ?? TrainerReading()
    session.advance(by: seconds, reading: reading)
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

  /// A controller part way through `template`, for previews.
  static func preview(
    _ template: WorkoutTemplate = .named("Recovery 30")!, ftp: Int = 200, minutes: Double = 16.5
  ) -> RideController {
    let controller = RideController(template: template, ftp: ftp, simulated: true)
    for _ in 0..<Int(minutes * 60) { controller.tick(seconds: 1) }
    return controller
  }
}

/// Starts and ends rides. Held by the root view, which shows the player while a ride is on.
@Observable
final class RideLauncher {
  private(set) var ride: RideController?
  @ObservationIgnored private let simulated: Bool

  init(simulated: Bool = false) {
    self.simulated = simulated
  }

  /// Starts `template` with targets from `ftp`, unless a ride is already on.
  func start(_ template: WorkoutTemplate, ftp: Int) {
    guard ride == nil else { return }
    ride = RideController(template: template, ftp: ftp, simulated: simulated)
  }

  func end() {
    ride?.stop()
    ride = nil
  }
}
