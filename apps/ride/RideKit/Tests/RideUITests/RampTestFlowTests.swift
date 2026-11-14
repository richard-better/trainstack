import Foundation
import RideCore
import RideData
import Testing

@testable import RideBluetooth
@testable import RideUI

struct RampTestFlowTests {
  private func withDirectory(_ body: (URL) throws -> Void) throws {
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "RampTestFlowTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    try body(directory)
  }

  private func launcher(in directory: URL) -> RideLauncher {
    let defaults = UserDefaults(suiteName: "RampTestFlowTests.\(UUID().uuidString)")!
    let devices = BluetoothDevices(transport: CyclingTestTransport(), defaults: defaults)
    return RideLauncher(
      simulated: true, devices: devices, journalDirectory: directory.appending(path: "journal"))
  }

  @Test func aSavedRampTestHandsOverItsResultAndOtherRidesDoNot() throws {
    try withDirectory { directory in
      let launcher = launcher(in: directory)
      let library = RideLibrary(directory: directory.appending(path: "rides"))
      launcher.start(
        RampTest(ftp: 200).planned, ftp: 200, heartRateZones: nil, riderWeight: 75)
      for _ in 0..<120 { launcher.ride?.tick(seconds: 1) }
      launcher.end(saveTo: library)
      let outcome = try #require(launcher.rampTestOutcome)
      #expect(outcome.result != nil)

      launcher.rampTestOutcome = nil
      launcher.start(
        WorkoutTemplate.library[0].planned, ftp: 200, heartRateZones: nil, riderWeight: 75)
      for _ in 0..<120 { launcher.ride?.tick(seconds: 1) }
      launcher.end(saveTo: library)
      #expect(launcher.rampTestOutcome == nil)
    }
  }

  @Test func savingARecoveredRampTestHandsOverItsResult() throws {
    try withDirectory { directory in
      let journalDirectory = directory.appending(path: "journal")
      let planned = RampTest(ftp: 200).planned
      let session = RideSession(workout: planned.workout(ftp: 200))
      let journal = RideJournal(
        directory: journalDirectory,
        header: .init(workout: planned, ftp: 200, startDate: session.startDate, riderWeight: 75))
      let crashed = RideController(
        workout: planned, ftp: 200, session: session, journal: journal, simulated: true)
      for _ in 0..<120 { crashed.tick(seconds: 1) }
      let launcher = launcher(in: directory)
      launcher.checkForInterruptedRide()
      launcher.saveInterrupted(to: RideLibrary(directory: directory.appending(path: "rides")))
      let outcome = try #require(launcher.rampTestOutcome)
      #expect(outcome.result != nil)
    }
  }

  @Test func aDiscardedRampTestHandsOverNothing() throws {
    try withDirectory { directory in
      let launcher = launcher(in: directory)
      launcher.start(RampTest(ftp: 200).planned, ftp: 200, heartRateZones: nil, riderWeight: 75)
      for _ in 0..<120 { launcher.ride?.tick(seconds: 1) }
      launcher.end(saveTo: nil)
      #expect(launcher.rampTestOutcome == nil)
    }
  }

  @Test func keepingTheEstimateAddsARampTestDatedTodayThatSetsFTPAndIsSent() throws {
    let today = Date(timeIntervalSince1970: 1_800_000_000)
    let store = RiderSettingsStore(settings: RiderSettings(), now: { today })
    var edits = 0
    store.onEdit = { edits += 1 }
    store.keepRampTestFTP(264)
    let test = try #require(store.ftpTests(in: .all).first)
    #expect(test.kind == .ramp)
    #expect(test.ftp == 264)
    #expect(Calendar.current.isDate(test.date, inSameDayAs: today))
    #expect(store.ftp == 264)
    #expect(edits == 1)
    #expect(store.offersMaxHeartRate(191))
    store.keepMaxHeartRate(191)
    #expect(!store.offersMaxHeartRate(185))
    #expect(!store.offersMaxHeartRate(191))
    #expect(store[.maxHeartRate, .all] == 191)
    #expect(edits == 2)
  }
}
