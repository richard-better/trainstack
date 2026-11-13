import Foundation
import RideData
import RideStrava
import Testing

@testable import RideUI

struct ActivitySyncTests {
  private struct Device {
    let library: RideLibrary
    let sync: ActivitySync
    let server: FakeActivityServer
    let rides: URL
    let state: URL

    static func launched(server: FakeActivityServer, rides: URL, state: URL) -> Device {
      let library = RideLibrary(directory: rides)
      let sync = ActivitySync(library: library, server: server, directory: state)
      library.onChange = { sync.remember($0) }
      return Device(library: library, sync: sync, server: server, rides: rides, state: state)
    }

    func relaunched() -> Device { .launched(server: server, rides: rides, state: state) }

    func ride(startingAt seconds: TimeInterval) throws -> Ride.ID {
      try library.add(rideFile(startingAt: seconds))
    }
  }

  private func withDevice(
    signedInAs account: String? = "ada", _ body: (Device) async throws -> Void
  ) async throws {
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "ActivitySyncTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    try await body(
      Device.launched(
        server: FakeActivityServer(signedInAs: account),
        rides: directory.appending(path: "Rides"), state: directory.appending(path: "State")))
  }

  private static func rideFile(startingAt seconds: TimeInterval) throws -> Data {
    let template = try #require(WorkoutTemplate.named("Quick test 45s"))
    var session = RideSession(
      workout: template.workout(ftp: 200),
      startDate: Date(timeIntervalSince1970: 1_800_000_000 + seconds))
    for _ in 0..<45 {
      session.advance(by: 1, reading: .init(power: 150, cadence: 90, heartRate: 130))
    }
    return FITEncoder.encode(session.recording())
  }

  private func rideFile(startingAt seconds: TimeInterval) throws -> Data {
    try Self.rideFile(startingAt: seconds)
  }

  @Test func uploadsEveryRideInTheLibraryTheServerDoesNotHave() async throws {
    try await withDevice { device in
      let first = try device.ride(startingAt: 0)
      let second = try device.ride(startingAt: 3600)
      await device.server.store(first, for: "ada")
      try await device.sync.sync()
      #expect(await device.server.uploads == [second])
      #expect(await device.server.activities(of: "ada") == [first, second])
    }
  }

  @Test func neverUploadsARideTwiceAcrossSyncsAndRelaunches() async throws {
    try await withDevice { device in
      _ = try device.ride(startingAt: 0)
      try await device.sync.sync()
      try await device.sync.sync()
      try await device.relaunched().sync.sync()
      #expect(await device.server.uploads.count == 1)
    }
  }

  @Test func aRideThatFinishesWhileSignedInIsUploaded() async throws {
    try await withDevice { device in
      try await device.sync.sync()
      let id = try device.ride(startingAt: 0)
      try await device.sync.sync()
      #expect(await device.server.uploads == [id])
    }
  }

  @Test func aRideFromAnotherDeviceThroughICloudIsUploadedToo() async throws {
    try await withDevice { device in
      let id = try #require(try device.library.receive(rideFile(startingAt: 0)))
      try await device.sync.sync()
      #expect(await device.server.uploads == [id])
    }
  }

  @Test func ridesRecordedOfflineAreUploadedOnceTheServerIsBack() async throws {
    try await withDevice { device in
      await device.server.goOffline()
      let id = try device.ride(startingAt: 0)
      await #expect(throws: StravaError.unavailable) { try await device.sync.sync() }
      await device.server.goOffline(false)
      try await device.relaunched().sync.sync()
      #expect(await device.server.uploads == [id])
    }
  }

  @Test func uploadsNothingWhileSignedOut() async throws {
    try await withDevice(signedInAs: nil) { device in
      _ = try device.ride(startingAt: 0)
      try await device.sync.sync()
      #expect(await device.server.calls.isEmpty)
    }
  }

  @Test func deletingARideDeletesItOnTheServer() async throws {
    try await withDevice { device in
      let id = try device.ride(startingAt: 0)
      try await device.sync.sync()
      device.library.remove(id)
      try await device.sync.sync()
      #expect(await device.server.deletions == [.delete(id, account: "ada")])
      #expect(await device.server.tombstones(of: "ada") == [id])
    }
  }

  @Test func aRideDeletedOfflineIsDeletedOnTheServerAfterARelaunch() async throws {
    try await withDevice { device in
      let id = try device.ride(startingAt: 0)
      try await device.sync.sync()
      await device.server.goOffline()
      device.library.remove(id)
      await #expect(throws: StravaError.unavailable) { try await device.sync.sync() }
      await device.server.goOffline(false)
      try await device.relaunched().sync.sync()
      #expect(await device.server.tombstones(of: "ada") == [id])
    }
  }

  @Test func aRideDeletedOnAnotherDeviceThroughICloudIsDeletedOnTheServer() async throws {
    try await withDevice { device in
      let id = try device.ride(startingAt: 0)
      try await device.sync.sync()
      device.library.removeReceived(id)
      try await device.sync.sync()
      #expect(await device.server.tombstones(of: "ada") == [id])
    }
  }

  @Test func aStaleDeviceDropsARideTheServerAnswersWasDeleted() async throws {
    try await withDevice { device in
      var removedHere: [RideLibrary.Change] = []
      device.library.onLocalChange = { removedHere.append($0) }
      let id = try device.ride(startingAt: 0)
      removedHere = []
      await device.server.deleteElsewhere(id, for: "ada")
      try await device.sync.sync()
      #expect(device.library[id] == nil)
      #expect(removedHere == [.removed(id)])
      #expect(await device.server.deletions.isEmpty)
      try await device.sync.sync()
      #expect(await device.server.uploads == [id])
    }
  }

  @Test func aRideDeletedOnAnotherDeviceThroughTheServerAloneIsDroppedHere() async throws {
    try await withDevice { device in
      var removedHere: [RideLibrary.Change] = []
      device.library.onLocalChange = { removedHere.append($0) }
      let id = try device.ride(startingAt: 0)
      let kept = try device.ride(startingAt: 3600)
      try await device.sync.sync()
      removedHere = []
      await device.server.deleteElsewhere(id, for: "ada")
      try await device.sync.sync()
      #expect(device.library[id] == nil)
      #expect(device.library[kept] != nil)
      #expect(removedHere == [.removed(id)])
      #expect(await device.server.uploads.count == 2)
      #expect(await device.server.deletions.isEmpty)
    }
  }

  @Test func aDeletedRideImportedAgainStaysOnThisDevice() async throws {
    try await withDevice { device in
      let data = try rideFile(startingAt: 0)
      let id = try device.library.add(data)
      try await device.sync.sync()
      device.library.remove(id)
      try await device.sync.sync()
      try device.library.add(data)
      try await device.sync.sync()
      #expect(device.library[id] != nil)
      #expect(await device.server.uploads == [id])
    }
  }

  @Test func aRideDeletedWhileSignedOutIsDeletedFromTheLastAccountWhenItSignsIn() async throws {
    try await withDevice { device in
      let id = try device.ride(startingAt: 0)
      try await device.sync.sync()
      await device.server.signIn(as: nil)
      device.library.remove(id)
      try await device.sync.sync()
      #expect(await device.server.deletions.isEmpty)
      await device.server.signIn(as: "ada")
      try await device.sync.sync()
      #expect(await device.server.tombstones(of: "ada") == [id])
    }
  }

  @Test func anotherAccountNeverHearsOfThisAccountsDeletions() async throws {
    try await withDevice { device in
      let data = try rideFile(startingAt: 0)
      let id = try device.library.add(data)
      try await device.sync.sync()
      device.library.remove(id)
      await device.server.signIn(as: "grace")
      try await device.sync.sync()
      #expect(await device.server.tombstones(of: "grace").isEmpty)
      try device.library.add(data)
      try await device.sync.sync()
      #expect(await device.server.activities(of: "grace") == [id])
      #expect(await device.server.tombstones(of: "ada").isEmpty)
      await device.server.signIn(as: "ada")
      try await device.sync.sync()
      #expect(await device.server.tombstones(of: "ada") == [id])
      #expect(device.library[id] != nil)
    }
  }

  @Test func retriesSoonAfterAFailureAndBacksOffToHalfAnHour() {
    #expect(ActivitySync.retryDelay(afterFailures: 1) == .seconds(30))
    #expect(ActivitySync.retryDelay(afterFailures: 2) == .seconds(60))
    #expect(ActivitySync.retryDelay(afterFailures: 20) == .seconds(30 * 60))
  }

  @Test func describesARideRecordedByRideAsAnIndoorRide() throws {
    let file = try Ride(
      recording: FITDecoder.decode(rideFile(startingAt: 0)), fileData: rideFile(startingAt: 0)
    ).activityFile
    #expect(file.source == "trainstack")
    #expect(file.sport == "indoor_cycling")
    #expect(file.name == "Quick test 45s")
    #expect(file.startedAt == Date(timeIntervalSince1970: 1_800_000_000))
  }
}
