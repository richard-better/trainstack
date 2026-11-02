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
}
