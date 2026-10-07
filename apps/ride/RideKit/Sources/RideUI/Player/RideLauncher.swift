import Observation
import RideData

/// Starts and ends rides. Held by the root view, which shows the player while a ride is on.
@Observable
final class RideLauncher {
  private(set) var ride: RideController?
  /// Whether the player is showing. On iOS the rider can minimise it to the tab bar while the
  /// ride carries on.
  var isPlayerPresented = false
  @ObservationIgnored private let simulated: Bool

  init(simulated: Bool = false) {
    self.simulated = simulated
  }

  /// Starts `template` with targets from `ftp`, unless a ride is already on.
  func start(_ template: WorkoutTemplate, ftp: Int) {
    guard ride == nil else { return }
    let ride = RideController(template: template, ftp: ftp, simulated: simulated)
    ride.start()
    self.ride = ride
    isPlayerPresented = true
  }

  func end() {
    ride?.stop()
    ride = nil
    isPlayerPresented = false
  }
}
