import Foundation
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
  /// A ride the app was closed on without ending, until the rider decides what to do with it.
  private(set) var interrupted: RideJournal.Interrupted?
  /// Whether the player is showing. On iOS the rider can minimise it to the tab bar while the
  /// ride carries on.
  var isPlayerPresented = false
  /// The rider's devices, which stay connected between rides.
  let devices: BluetoothDevices
  @ObservationIgnored private let simulated: Bool
  @ObservationIgnored private let journalDirectory: URL
  @ObservationIgnored private let heartRate = HeartRateFeed()
  #if os(macOS)
    @ObservationIgnored private lazy var watchRelay: WatchRelayReceiver = {
      let receiver = WatchRelayReceiver()
      receiver.onReading = { [heartRate] bpm in heartRate.record(bpm, from: .watch) }
      return receiver
    }()
  #endif

  init(
    simulated: Bool = false, devices: BluetoothDevices = BluetoothDevices(),
    journalDirectory: URL = RideJournal.defaultDirectory
  ) {
    self.simulated = simulated
    self.devices = devices
    self.journalDirectory = journalDirectory
    devices.onHeartRate = { [heartRate] bpm in heartRate.record(bpm, from: .chestStrap) }
  }

  /// Starts `template` with targets from `ftp`, unless a ride is already on or one is waiting
  /// to be dealt with.
  func start(_ template: WorkoutTemplate, ftp: Int, heartRateZones: ZoneSet?) {
    guard ride == nil, interrupted == nil else { return }
    let session = RideSession(workout: template.workout(ftp: ftp))
    let journal = RideJournal(
      directory: journalDirectory,
      header: .init(template: template, ftp: ftp, startDate: session.startDate))
    begin(
      RideController(
        template: template, ftp: ftp, heartRateZones: heartRateZones, heartRate: heartRate,
        devices: devices, session: session, journal: journal, simulated: simulated))
  }

  private func begin(_ ride: RideController) {
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

  /// Ends the ride, keeping it in `library` if there is one.
  func end(saveTo library: RideLibrary? = nil) {
    if let recording = ride?.session.recording(), !recording.samples.isEmpty {
      library?.save(recording)
    }
    ride?.stop()
    ride?.journal?.finish()
    ride = nil
    isPlayerPresented = false
    #if os(macOS)
      watchRelay.stop()
    #endif
    #if os(iOS)
      WatchLink.shared.endRide()
    #endif
  }

  // MARK: Interrupted rides

  /// Looks for a ride left over from a crash or a quit, to offer to pick it up.
  func checkForInterruptedRide() {
    guard ride == nil, interrupted == nil else { return }
    interrupted = RideJournal.recover(from: journalDirectory)
  }

  /// Carries on the interrupted ride, paused where it stopped.
  func resumeInterrupted(heartRateZones: ZoneSet?) {
    guard ride == nil, let interrupted else { return }
    self.interrupted = nil
    begin(
      RideController(
        template: interrupted.header.template, ftp: interrupted.header.ftp,
        heartRateZones: heartRateZones, heartRate: heartRate, devices: devices,
        session: interrupted.session(), journal: RideJournal(resuming: journalDirectory),
        simulated: simulated))
  }

  /// Keeps what was ridden of the interrupted ride in `library`.
  func saveInterrupted(to library: RideLibrary) {
    guard let interrupted else { return }
    library.save(interrupted.session().recording())
    discardInterrupted()
  }

  func discardInterrupted() {
    interrupted = nil
    RideJournal.discard(in: journalDirectory)
  }
}
