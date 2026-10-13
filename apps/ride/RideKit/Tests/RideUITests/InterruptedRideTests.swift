import Foundation
import RideData
import Testing

@testable import RideBluetooth
@testable import RideUI

struct InterruptedRideTests {
  private let template = WorkoutTemplate.named("Quick test 45s")!

  private func withDirectory(_ body: (URL) throws -> Void) throws {
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "InterruptedRideTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    try body(directory)
  }

  private func launcher(journalDirectory: URL) -> RideLauncher {
    let defaults = UserDefaults(suiteName: "InterruptedRideTests.\(UUID().uuidString)")!
    let devices = BluetoothDevices(transport: CyclingTestTransport(), defaults: defaults)
    return RideLauncher(simulated: true, devices: devices, journalDirectory: journalDirectory)
  }

  /// A ride that got `seconds` in and was never ended.
  private func crashedRide(_ seconds: Int, in directory: URL) throws {
    let session = RideSession(workout: template.workout(ftp: 200))
    let journal = RideJournal(
      directory: directory,
      header: .init(template: template, ftp: 200, startDate: session.startDate))
    let controller = RideController(
      template: template, ftp: 200, session: session, journal: journal, simulated: true)
    for _ in 0..<seconds { controller.tick(seconds: 1) }
  }

  @Test func aRideJournalsEachSecondItIsRidden() throws {
    try withDirectory { directory in
      try crashedRide(20, in: directory)
      let interrupted = try #require(RideJournal.recover(from: directory))
      #expect(interrupted.name == "Quick test 45s")
      #expect(interrupted.samples.count == 20)
      #expect(interrupted.state.position == 20)
    }
  }

  @Test func journalsThePauseAndWhatTheRiderChanged() throws {
    try withDirectory { directory in
      let session = RideSession(workout: template.workout(ftp: 200))
      let controller = RideController(
        template: template, ftp: 200, session: session,
        journal: RideJournal(
          directory: directory,
          header: .init(template: template, ftp: 200, startDate: session.startDate)),
        simulated: true)
      for _ in 0..<5 { controller.tick(seconds: 1) }
      controller.adjust(by: 10)
      controller.togglePause()
      controller.tick(seconds: 1)
      let interrupted = try #require(RideJournal.recover(from: directory))
      #expect(interrupted.samples.count == 5)
      #expect(interrupted.state.ergPercent == 110)
      #expect(interrupted.state.isPaused)
    }
  }

  @Test func theLauncherFindsARideLeftOver() throws {
    try withDirectory { directory in
      let launcher = launcher(journalDirectory: directory)
      launcher.checkForInterruptedRide()
      #expect(launcher.interrupted == nil)

      try crashedRide(12, in: directory)
      launcher.checkForInterruptedRide()
      #expect(launcher.interrupted?.samples.count == 12)
    }
  }

  @Test func savingWhatWasRiddenKeepsItInHistoryAndClearsTheJournal() throws {
    try withDirectory { directory in
      try crashedRide(30, in: directory)
      let launcher = launcher(journalDirectory: directory)
      let library = RideLibrary()
      launcher.checkForInterruptedRide()
      launcher.saveInterrupted(to: library)

      let ride = try #require(library.rides.first)
      #expect(ride.title == "Quick test 45s")
      #expect(ride.recording.samples.count == 30)
      #expect(ride.recording.hasTarget)
      #expect(launcher.interrupted == nil)
      #expect(RideJournal.recover(from: directory) == nil)
    }
  }

  @Test func discardingClearsTheJournal() throws {
    try withDirectory { directory in
      try crashedRide(30, in: directory)
      let launcher = launcher(journalDirectory: directory)
      launcher.checkForInterruptedRide()
      launcher.discardInterrupted()
      #expect(launcher.interrupted == nil)
      #expect(RideJournal.recover(from: directory) == nil)
    }
  }

  @Test func aRealLaunchJournalsWhereItPicksUpRides() {
    #expect(
      RideLauncher.launchJournalDirectory(arguments: ["Ride"]) == RideJournal.defaultDirectory)
    #expect(
      RideLauncher.launchJournalDirectory(arguments: ["Ride", "-NSDocumentRevisionsDebugMode"])
        == RideJournal.defaultDirectory)
  }

  @Test(arguments: [
    ["Ride", "-ride", "Quick test 45s"], ["Ride", "-sample-rides"],
    ["Ride", "-simulated-trainer"], ["Ride", "-sample-devices"],
  ])
  func aPretendLaunchJournalsInAFolderOfItsOwn(arguments: [String]) {
    let directory = RideLauncher.launchJournalDirectory(arguments: arguments)
    #expect(directory != RideJournal.defaultDirectory)
    #expect(directory.path.hasPrefix(URL.temporaryDirectory.path))
    #expect(!directory.path.hasPrefix(RideJournal.defaultDirectory.path))
  }

  @Test func aRideCannotStartWhileOneWaits() throws {
    try withDirectory { directory in
      try crashedRide(10, in: directory)
      let launcher = launcher(journalDirectory: directory)
      launcher.checkForInterruptedRide()
      launcher.start(template, ftp: 200, heartRateZones: nil, riderWeight: 75)
      #expect(launcher.ride == nil)
      #expect(RideJournal.recover(from: directory)?.samples.count == 10)
    }
  }
}
