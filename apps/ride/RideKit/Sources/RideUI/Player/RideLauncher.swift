import Observation
import RideBluetooth
import RideData

/// Starts and ends rides. Held by the root view, which shows the player while a ride is on.
///
/// A ride takes power and cadence from its selected sensors, and heart rate from the rider's
/// paired strap and from an Apple Watch: on iPhone
/// directly, as the watch starts its workout with the ride, and on the Mac through an iPhone
/// relaying it.
@Observable
final class RideLauncher {
  private(set) var ride: RideController?
  /// Whether the player is showing. The rider can minimise it while the ride carries on.
  var isPlayerPresented = false
  /// The rider's devices, which stay connected between rides.
  let devices: BluetoothDevices
  @ObservationIgnored private let simulated: Bool
  @ObservationIgnored private let heartRate = HeartRateFeed()
  #if os(macOS)
    @ObservationIgnored private lazy var watchRelay: WatchRelayReceiver = {
      let receiver = WatchRelayReceiver()
      receiver.onReading = { [heartRate] bpm in heartRate.record(bpm, from: .watch) }
      return receiver
    }()
  #endif

  init(simulated: Bool = false, devices: BluetoothDevices = BluetoothDevices()) {
    self.simulated = simulated
    self.devices = devices
    devices.onHeartRate = { [heartRate] bpm in heartRate.record(bpm, from: .chestStrap) }
  }

  /// Starts `template` with targets from `ftp`, unless a ride is already on.
  func start(_ template: WorkoutTemplate, ftp: Int, heartRateZones: ZoneSet?) {
    guard ride == nil else { return }
    let ride = RideController(
      template: template, ftp: ftp, heartRateZones: heartRateZones, heartRate: heartRate,
      devices: devices, simulated: simulated)
    #if os(iOS)
      let watch = WatchLink.shared
      watch.onHeartRate = { [heartRate] bpm in heartRate.record(bpm, from: .watch) }
      ride.onTick = { [weak ride] in
        if let ride { watch.send(.glance(ride.glance)) }
      }
      watch.startWorkout()
    #endif
    #if os(macOS)
      watchRelay.start()
    #endif
    ride.start()
    self.ride = ride
    isPlayerPresented = true
  }

  func end() {
    ride?.stop()
    ride = nil
    isPlayerPresented = false
    #if os(macOS)
      watchRelay.stop()
    #endif
    #if os(iOS)
      WatchLink.shared.endRide()
    #endif
  }
}
