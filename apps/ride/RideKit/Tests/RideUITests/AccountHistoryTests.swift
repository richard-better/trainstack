import Foundation
import RideData
import RideStrava
import RideTestSupport
import Testing

@testable import RideUI

struct AccountHistoryTests {
  private struct Device {
    let library: RideLibrary
    let history: AccountHistory
    let sync: ActivitySync
    let server: FakeActivityServer
    let root: URL

    static func launched(
      server: FakeActivityServer, root: URL, cacheLimit: Int = AccountHistory.defaultCacheLimit
    ) -> Device {
      let library = RideLibrary(directory: root.appending(path: "Rides"))
      let history = AccountHistory(
        server: server, directory: root.appending(path: "History"),
        cache: root.appending(path: "Caches"), cacheLimit: cacheLimit)
      let sync = ActivitySync(
        library: library, history: history, server: server,
        directory: root.appending(path: "State"))
      library.onChange = { sync.remember($0) }
      library.onOpenedByHand = { sync.openedByHand($0) }
      return Device(library: library, history: history, sync: sync, server: server, root: root)
    }

    func relaunched() -> Device { .launched(server: server, root: root) }

    var shown: [String] {
      HistoryEntry.merging(rides: library.rides, account: history.activities).map(\.id)
    }
  }

  private func withDevice(
    signedInAs account: String? = "ada", cacheLimit: Int = AccountHistory.defaultCacheLimit,
    _ body: (Device) async throws -> Void
  ) async throws {
    let root = FileManager.default.temporaryDirectory.appending(
      path: "AccountHistoryTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: root) }
    try await body(
      Device.launched(
        server: FakeActivityServer(signedInAs: account), root: root, cacheLimit: cacheLimit))
  }

  private static func rideFile(startingAt seconds: TimeInterval) -> Data {
    var session = RideSession(
      workout: WorkoutTemplate.quickTest.workout(ftp: 200),
      startDate: Date(timeIntervalSince1970: 1_800_000_000 + seconds))
    for _ in 0..<45 {
      session.advance(by: 1, reading: .init(power: 150, cadence: 90, heartRate: 130))
    }
    return FITEncoder.encode(session.recording())
  }

  private static func id(of file: Data) throws -> String {
    Ride(recording: try FITDecoder.decode(file), fileData: file).id
  }

  private static func activity(
    _ id: String, at seconds: TimeInterval = 0, sport: String = "running", primary: Bool = true,
    duplicates: [String] = []
  ) -> AccountActivity {
    AccountActivity(
      id: id, source: "apple_health", sport: sport, indoor: false,
      startedAt: Date(timeIntervalSince1970: 1_800_000_000 + seconds),
      statistics: ["timer_s": 2700], primary: primary, duplicateIDs: duplicates)
  }

  private static let run = String(repeating: "a", count: 64)
  private static let lift = String(repeating: "b", count: 64)

  @Test func signedInHistoryListsTheAccountsActivitiesBesideTheDevicesRides() async throws {
    try await withDevice { device in
      let ride = try device.library.add(Self.rideFile(startingAt: 0))
      await device.server.store(Self.activity(Self.run, at: 100), for: "ada")
      await device.server.store(
        AccountActivity(
          id: Self.lift, sport: "strength",
          startedAt: Date(timeIntervalSince1970: 1_800_000_200), file: nil,
          logged: LoggedSummary(sport: "strength", exercises: 4)), for: "ada")
      try await device.sync.sync()
      #expect(device.shown == [Self.lift, Self.run, ride])
      try await device.sync.sync()
      #expect(device.shown == [Self.lift, Self.run, ride])
      #expect(await device.server.downloads.isEmpty)
    }
  }

  @Test func aWorkoutRecordedTwiceIsShownOnceByTheActivityThatStandsForIt() async throws {
    try await withDevice { device in
      let file = Self.rideFile(startingAt: 0)
      let ride = try device.library.add(file)
      try await device.sync.sync()
      await device.server.store(Self.activity(Self.run, duplicates: [ride]), for: "ada")
      await device.server.store(
        Self.activity(ride, sport: "cycling", primary: false, duplicates: [Self.run]),
        for: "ada")
      try await device.sync.sync()
      #expect(device.shown == [Self.run])
      #expect(device.library.rides.map(\.id) == [ride])
    }
  }

  @Test func aDeletionOnTheWebRemovesTheActivityAndItsDownloadedFile() async throws {
    try await withDevice { device in
      let file = Self.rideFile(startingAt: 0)
      let id = try Self.id(of: file)
      await device.server.store(Self.activity(id), file: file, for: "ada")
      try await device.sync.sync()
      #expect(try await device.history.download(id) == file)
      await device.server.deleteElsewhere(id, for: "ada")
      try await device.sync.sync()
      #expect(device.shown.isEmpty)
      #expect(device.history.file(of: id) == nil)
      #expect(device.relaunched().history.activities.isEmpty)
    }
  }

  @Test func aDeletionOnTheWebRemovesARideRecordedOnThisDevice() async throws {
    try await withDevice { device in
      let ride = try device.library.add(Self.rideFile(startingAt: 0))
      try await device.sync.sync()
      #expect(device.shown == [ride])
      await device.server.deleteElsewhere(ride, for: "ada")
      try await device.sync.sync()
      #expect(device.shown.isEmpty)
      #expect(device.library.rides.isEmpty)
    }
  }

  @Test func aDownloadedFileIsNeverUploadedBackNorAddedToTheDevicesRides() async throws {
    try await withDevice { device in
      let file = Self.rideFile(startingAt: 0)
      let id = try Self.id(of: file)
      await device.server.store(Self.activity(id, sport: "cycling"), file: file, for: "ada")
      try await device.sync.sync()
      _ = try await device.history.download(id)
      try await device.sync.sync()
      await device.server.deleteElsewhere(id, for: "ada")
      await device.server.store(String(repeating: "c", count: 64), for: "ada")
      try await device.sync.sync()
      try await device.relaunched().sync.sync()
      #expect(await device.server.uploads.isEmpty)
      #expect(await device.server.restores.isEmpty)
      #expect(device.library.rides.isEmpty)
      #expect(device.relaunched().library.rides.isEmpty)
    }
  }

  @Test func anActivityIsDownloadedOnlyWhenOpenedAndOnlyOnce() async throws {
    try await withDevice { device in
      let file = Self.rideFile(startingAt: 0)
      let id = try Self.id(of: file)
      await device.server.store(Self.activity(id), file: file, for: "ada")
      await device.server.store(Self.activity(Self.run, at: 60), file: file, for: "ada")
      try await device.sync.sync()
      #expect(await device.server.downloads.isEmpty)
      async let first = device.history.download(id)
      async let second = device.history.download(id)
      #expect(try await [first, second] == [file, file])
      #expect(try await device.relaunched().history.download(id) == file)
      #expect(await device.server.downloads == [id])
    }
  }

  @Test func offlineTheListAndDownloadedFilesAreWhatWasLastKnown() async throws {
    try await withDevice { device in
      let file = Self.rideFile(startingAt: 0)
      let id = try Self.id(of: file)
      await device.server.store(Self.activity(id), file: file, for: "ada")
      await device.server.store(Self.activity(Self.run, at: 60), file: file, for: "ada")
      try await device.sync.sync()
      _ = try await device.history.download(id)
      await device.server.goOffline()
      let relaunched = device.relaunched()
      await #expect(throws: StravaError.unavailable) { try await relaunched.sync.sync() }
      #expect(relaunched.shown == [Self.run, id])
      #expect(try await relaunched.history.download(id) == file)
      await #expect(throws: StravaError.unavailable) {
        try await relaunched.history.download(Self.run)
      }
    }
  }

  @Test func signingOutRemovesWhatBelongsToTheAccountAndKeepsThisDevicesRides() async throws {
    try await withDevice { device in
      let ride = try device.library.add(Self.rideFile(startingAt: 0))
      let file = Self.rideFile(startingAt: 500)
      let id = try Self.id(of: file)
      await device.server.store(Self.activity(id, at: 500), file: file, for: "ada")
      try await device.sync.sync()
      _ = try await device.history.download(id)
      await device.server.signIn(as: nil)
      await #expect(throws: StravaError.signedOut) { try await device.sync.sync() }
      #expect(device.shown == [ride])
      #expect(device.history.file(of: id) == nil)
      #expect(device.history.cachedFileBytes == 0)
      #expect(device.relaunched().shown == [ride])
      #expect(await device.server.deletions.isEmpty)
    }
  }

  @Test func anotherAccountOnTheSameDeviceNeverSeesTheFirstOnesActivities() async throws {
    try await withDevice { device in
      let file = Self.rideFile(startingAt: 0)
      let id = try Self.id(of: file)
      await device.server.store(Self.activity(id), file: file, for: "ada")
      try await device.sync.sync()
      _ = try await device.history.download(id)
      await device.server.signIn(as: "grace")
      await device.server.goOffline()
      device.sync.accountChanged()
      #expect(device.shown.isEmpty)
      #expect(device.history.file(of: id) == nil)
      await #expect(throws: StravaError.unavailable) { try await device.sync.sync() }
      #expect(device.shown.isEmpty)
      await device.server.goOffline(false)
      try await device.sync.sync()
      #expect(device.history.account == "grace")
      #expect(device.shown.isEmpty)
      #expect(device.history.file(of: id) == nil)
      await #expect(throws: (any Error).self) { try await device.history.download(id) }
      #expect(device.relaunched().shown.isEmpty)
    }
  }

  @Test func aDownloadThatEndsAfterSigningOutIsNotKept() async throws {
    try await withDevice { device in
      let file = Self.rideFile(startingAt: 0)
      let id = try Self.id(of: file)
      await device.server.store(Self.activity(id), file: file, for: "ada")
      try await device.sync.sync()
      await device.server.holdReplies(to: .file)
      let download = Task { try await device.history.download(id) }
      while !(await device.server.isHoldingAReply) { await Task.yield() }
      await device.server.signIn(as: nil)
      await #expect(throws: StravaError.signedOut) { try await device.sync.sync() }
      await device.server.releaseReplies()
      await #expect(throws: (any Error).self) { try await download.value }
      #expect(device.history.cachedFileBytes == 0)
    }
  }

  @Test func deletingAnActivityFromTheAppDeletesItOnTheAccount() async throws {
    try await withDevice { device in
      await device.server.store(Self.activity(Self.run), for: "ada")
      try await device.sync.sync()
      await device.server.holdReplies(to: .list)
      let pass = Task { try await device.sync.sync() }
      while !(await device.server.isHoldingAReply) { await Task.yield() }
      device.sync.delete(Self.run)
      #expect(device.shown.isEmpty)
      await device.server.releaseReplies()
      try await pass.value
      #expect(device.shown.isEmpty)
      while true {
        let calls = await device.server.calls
        if calls.last == .list(account: "ada"), calls.contains(.delete(Self.run, account: "ada")) {
          break
        }
        await Task.yield()
      }
      #expect(await device.server.deletions == [.delete(Self.run, account: "ada")])
      #expect(device.shown.isEmpty)
    }
  }

  @Test func theDownloadedFilesStayWithinTheirLimitDroppingTheLeastRecentlyOpened() async throws {
    let files = (0..<3).map { Self.rideFile(startingAt: TimeInterval($0) * 1000) }
    try await withDevice(cacheLimit: files[0].count * 2 + 10) { device in
      let ids = try files.map(Self.id(of:))
      for (id, file) in zip(ids, files) {
        await device.server.store(Self.activity(id), file: file, for: "ada")
      }
      try await device.sync.sync()
      _ = try await device.history.download(ids[0])
      try await Task.sleep(for: .milliseconds(20))
      _ = try await device.history.download(ids[1])
      try await Task.sleep(for: .milliseconds(20))
      _ = device.history.file(of: ids[0])
      try await Task.sleep(for: .milliseconds(20))
      _ = try await device.history.download(ids[2])
      #expect(device.history.file(of: ids[0]) != nil)
      #expect(device.history.file(of: ids[1]) == nil)
      #expect(device.history.file(of: ids[2]) != nil)
      #expect(device.history.cachedFileBytes <= files[0].count * 2 + 10)
    }
  }
}
