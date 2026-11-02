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
    #expect(abs(try #require(ride.summary.distanceMetres) - 14389) < 1)
  }

  @Test func decodesTheSport() throws {
    #expect(try RideRecording.sample().sport == .cycling)
    #expect(Sport(fitSport: 1, subSport: nil) == .running)
    #expect(Sport(fitSport: 10, subSport: 20) == .strength)
    #expect(Sport(fitSport: 10, subSport: 26) == nil)
    #expect(Sport(fitSport: 0, subSport: nil) == nil)
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
    #expect(ride.startDate == Date(timeIntervalSince1970: 1_791_296_475))
  }

  @Test func countsFITTimestampsFromTheLastDayOf1989() throws {
    let lastDayOf1989 = try Date("1989-12-31T00:00:00Z", strategy: .iso8601)
    let epoch = Date(timeIntervalSince1970: TimeInterval(FITProfile.epochInUnixTime))
    #expect(epoch == lastDayOf1989)
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
