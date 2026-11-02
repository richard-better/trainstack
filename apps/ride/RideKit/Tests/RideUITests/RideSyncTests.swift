import CloudKit
import Foundation
import RideData
import Testing

@testable import RideUI

struct RideSyncTests {
  private func withLibrary(_ body: (RideLibrary, URL) throws -> Void) throws {
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "RideSyncTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    try body(RideLibrary(directory: directory), directory.appending(path: "State.json"))
  }

  @Test func namesEachRidesRecordByItsIDSoEveryDeviceSendsTheSameRecord() throws {
    try withLibrary { library, stateURL in
      let id = try library.add(RideRecording.sampleFITData())
      let recordID = RideSync(library: library, stateURL: stateURL).recordID(id)
      #expect(recordID.recordName == id)
      #expect(recordID.zoneID.zoneName == "Rides")
    }
  }

  @Test func aRidesRecordHoldsItsFITFileUnchanged() throws {
    try withLibrary { library, stateURL in
      let data = try RideRecording.sampleFITData()
      let id = try library.add(data)
      let sync = RideSync(library: library, stateURL: stateURL)
      let record = try #require(sync.record(for: sync.recordID(id)))
      let asset = try #require(record["file"] as? CKAsset)
      #expect(record.recordType == "Ride")
      #expect(try Data(contentsOf: #require(asset.fileURL)) == data)
    }
  }

  @Test func sendsNoRecordForARideNoLongerOnTheDevice() throws {
    try withLibrary { library, stateURL in
      let id = try library.add(RideRecording.sampleFITData())
      library.remove(id)
      let sync = RideSync(library: library, stateURL: stateURL)
      #expect(sync.record(for: sync.recordID(id)) == nil)
    }
  }

  @Test func deletingARideLeavesARecordThatItWasDeleted() throws {
    try withLibrary { library, stateURL in
      let id = try library.add(RideRecording.sampleFITData())
      let sync = RideSync(library: library, stateURL: stateURL)
      #expect(
        sync.changes(toSendFor: .removed(id)) == [
          .deleteRecord(sync.recordID(id)), .saveRecord(sync.deletedRecordID(id)),
        ])
      let record = try #require(sync.record(for: sync.deletedRecordID(id)))
      #expect(record.recordType == "DeletedRide")
    }
  }

  @Test func aDeviceThatHasNotSyncedSinceARideWasDeletedDropsItInsteadOfSendingItBack() throws {
    try withLibrary { library, stateURL in
      let id = try library.add(RideRecording.sampleFITData())
      let sync = RideSync(library: library, stateURL: stateURL)
      let deletedElsewhere = CKRecord(
        recordType: "DeletedRide", recordID: sync.deletedRecordID(id))
      #expect(sync.receive(deletedElsewhere) == [.deleteRecord(sync.recordID(id))])
      #expect(library[id] == nil)
      #expect(sync.record(for: sync.recordID(id)) == nil)
      #expect(!sync.everythingToSend().contains(.saveRecord(sync.recordID(id))))
    }
  }

  @Test func aDeletedRideSentBackByAStaleDeviceIsDeletedAgain() throws {
    try withLibrary { library, stateURL in
      let data = try RideRecording.sampleFITData()
      let id = try library.add(data)
      library.remove(id)
      let sync = RideSync(library: library, stateURL: stateURL)
      _ = sync.changes(toSendFor: .removed(id))
      let resent = CKRecord(recordType: "Ride", recordID: sync.recordID(id))
      resent["file"] = CKAsset(fileURL: try writeTemporaryFile(data))
      #expect(sync.receive(resent) == [.deleteRecord(sync.recordID(id))])
      #expect(library[id] == nil)
    }
  }

  @Test func remembersDeletedRidesBetweenLaunches() throws {
    try withLibrary { library, stateURL in
      let id = try library.add(RideRecording.sampleFITData())
      _ = RideSync(library: library, stateURL: stateURL).changes(toSendFor: .removed(id))
      let relaunched = RideSync(library: library, stateURL: stateURL)
      #expect(relaunched.everythingToSend().contains(.saveRecord(relaunched.deletedRecordID(id))))
      #expect(relaunched.changes(toSendFor: .added(id)) == [])
    }
  }

  @Test func aDeletedRideImportedAgainStaysOnThisDevice() throws {
    try withLibrary { library, stateURL in
      let data = try RideRecording.sampleFITData()
      let id = try library.add(data)
      let sync = RideSync(library: library, stateURL: stateURL)
      _ = sync.changes(toSendFor: .removed(id))
      library.remove(id)
      try library.add(data)
      sync.receiveDeletion(of: sync.recordID(id))
      _ = sync.receive(CKRecord(recordType: "DeletedRide", recordID: sync.deletedRecordID(id)))
      #expect(library[id] != nil)
    }
  }

  private func writeTemporaryFile(_ data: Data) throws -> URL {
    let url = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString).fit")
    try data.write(to: url)
    return url
  }
}
