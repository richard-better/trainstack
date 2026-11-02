import Foundation
import Observation
import RideBluetooth
import RideCore
import RideData

@Observable
final class RideLauncher {
  private(set) var ride: RideController?
  private(set) var interrupted: InterruptedRide?
  var isPlayerPresented = false
  var isConfirmingEnd = false
  let devices: BluetoothDevices
  var powerDisplay = PowerDisplay.standard {
    didSet { ride?.powerDisplay = powerDisplay }
  }
  @ObservationIgnored private let simulated: Bool
  @ObservationIgnored private let journalDirectory: URL
  @ObservationIgnored private let heartRate = HeartRateFeed()
  @ObservationIgnored private let keepAwake = KeepAwake()
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

  func start(
    _ template: WorkoutTemplate, ftp: Int, heartRateZones: ZoneSet?, riderWeight: Double
  ) {
    guard ride == nil, interrupted == nil else { return }
    let session = RideSession(workout: template.workout(ftp: ftp), riderWeight: riderWeight)
    let journal = RideJournal(
      directory: journalDirectory,
      header: .init(
        template: template, ftp: ftp, startDate: session.startDate, riderWeight: riderWeight))
    begin(
      RideController(
        template: template, ftp: ftp, heartRateZones: heartRateZones, heartRate: heartRate,
        devices: devices, session: session, journal: journal, simulated: simulated))
  }

  private func begin(_ ride: RideController) {
    ride.powerDisplay = powerDisplay
    #if os(iOS)
      let watch = WatchLink.shared
      watch.onHeartRate = { [heartRate] bpm in heartRate.record(bpm, from: .watch) }
      ride.onTick = { [weak ride] in
        if let ride { watch.sendGlance(ride.glance) }
      }
      watch.isRecordingRide = true
      watch.startWorkout()
    #endif
    #if os(macOS)
      watchRelay.start(claim: AppSync.shared.claim)
    #endif
    keepAwake.begin()
    ride.start()
    self.ride = ride
    isPlayerPresented = true
  }

  func end(saveTo library: RideLibrary? = nil) {
    if let recording = ride?.session.recording(), !recording.samples.isEmpty, let library {
      keep(recording, in: library)
    }
    ride?.stop()
    ride?.journal?.finish()
    ride = nil
    isPlayerPresented = false
    isConfirmingEnd = false
    keepAwake.end()
    #if os(macOS)
      watchRelay.stop()
    #endif
    #if os(iOS)
      WatchLink.shared.isRecordingRide = false
      WatchLink.shared.endRide()
    #endif
  }

  private func keep(_ recording: RideRecording, in library: RideLibrary) {
    #if os(iOS)
      library.save(recording) { HealthRides.shared.queue($0.id, in: library) }
      HealthRides.shared.saveQueuedSoon(from: library)
    #else
      library.save(recording)
    #endif
  }

  func checkForInterruptedRide() {
    guard ride == nil, interrupted == nil else { return }
    interrupted = RideJournal.recover(from: journalDirectory)
  }

  func resumeInterrupted(heartRateZones: ZoneSet?) {
    guard ride == nil, let interrupted else { return }
    self.interrupted = nil
    begin(
      RideController(
        resuming: interrupted, heartRateZones: heartRateZones, heartRate: heartRate,
        devices: devices, journal: RideJournal(resuming: journalDirectory), simulated: simulated))
  }

  func saveInterrupted(to library: RideLibrary) {
    guard let interrupted else { return }
    keep(interrupted.session.recording(), in: library)
    self.interrupted = nil
    RideJournal.finish(in: journalDirectory)
  }

  func discardInterrupted() {
    interrupted = nil
    RideJournal.discard(in: journalDirectory)
  }
}
