import Foundation
import Testing

@testable import RideData

struct FITDecoderTests {
  @Test func decodesTheSampleRideSummary() throws {
    let ride = try RideRecording.sample()
    #expect(ride.summary.duration == 1800)
    #expect(ride.summary.averagePower == 137)
    #expect(ride.summary.maxPower == 177)
    #expect(ride.summary.averageHeartRate == 146)
    #expect(ride.summary.maxHeartRate == 167)
    #expect(abs(try #require(ride.summary.distance) - 14389) < 1)
  }

  @Test func decodesOneSamplePerSecond() throws {
    let ride = try RideRecording.sample()
    #expect(ride.samples.count == 1801)
    #expect(ride.samples.first?.elapsed == 0)
    #expect(ride.samples.last?.elapsed == 1800)
    #expect(ride.samples.map(\.elapsed) == (0...1800).map(TimeInterval.init))
    #expect(ride.hasPower && ride.hasHeartRate)
  }

  @Test func startsAtTheSessionStartTime() throws {
    let ride = try RideRecording.sample()
    // FIT timestamp 1160230875 + 631065600 epoch offset.
    #expect(ride.startDate == Date(timeIntervalSince1970: 1_791_296_475))
  }

  @Test func rejectsNonFITData() {
    #expect(throws: FITError.notAFITFile) {
      try FITDecoder.decode(Data(repeating: 0x41, count: 64))
    }
    #expect(throws: FITError.truncated) { try FITDecoder.decode(Data([0x0E, 0x10])) }
  }

  @Test func rejectsCorruptData() throws {
    var data = try RideRecording.sampleFITData()
    data[data.count / 2] ^= 0xFF
    #expect(throws: FITError.badChecksum) { try FITDecoder.decode(data) }
  }

  @Test func rejectsTruncatedData() throws {
    let data = try RideRecording.sampleFITData()
    #expect(throws: FITError.truncated) { try FITDecoder.decode(data.prefix(data.count - 40)) }
  }
}

struct ExportFileNameTests {
  @Test func keepsOrdinaryWorkoutNames() throws {
    var ride = try RideRecording.sample()
    ride.workoutName = "Threshold builder"
    #expect(ride.exportFileName == "Threshold builder 2026-10-06.fit")
  }

  @Test func neverEscapesItsDirectory() throws {
    var ride = try RideRecording.sample()
    for name in ["../../etc/passwd", "..\\..\\x", "a/b:c", "/", "..", "\u{0}\n"] {
      ride.workoutName = name
      let fileName = ride.exportFileName
      #expect(!fileName.contains("/") && !fileName.contains("\\") && !fileName.hasPrefix("."))
      #expect(
        URL(filePath: "/tmp/ride").appending(path: fileName).deletingLastPathComponent().path
          == "/tmp/ride")
    }
  }
}
