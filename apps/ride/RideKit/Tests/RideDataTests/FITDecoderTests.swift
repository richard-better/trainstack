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

  @Test func readsTheTimerPausesOfASmartRecordedRide() throws {
    let ride = try FITDecoder.decode(smartRecordedRide(stoppedFrom: 60, until: 90))
    #expect(ride.pauses == [60..<90])
    #expect(ride.workKilojoules() == 18)
  }

  @Test func keepsOnlyThePausesThatFallBetweenItsRecords() throws {
    let ride = try FITDecoder.decode(smartRecordedRide(stoppedFrom: 120, until: nil))
    #expect(ride.pauses.isEmpty)
    #expect(ride.workKilojoules() == 24)
  }

  private func smartRecordedRide(
    stoppedFrom stop: UInt32, until restart: UInt32?
  ) -> Data {
    typealias Event = FITProfile.EventField
    let timestamp = FITProfile.CommonField.timestamp
    let start: UInt32 = 1_000_000_000
    var writer = FITWriter()
    func timer(_ seconds: UInt32, _ type: UInt8) {
      writer.message(
        local: 0, global: FITProfile.MessageNumber.event,
        [
          .uint32(timestamp, start + seconds),
          .enumeration(Event.event, FITProfile.Event.timer), .enumeration(Event.eventType, type),
        ])
    }
    timer(0, FITProfile.EventType.start)
    for seconds in stride(from: UInt32(0), through: 120, by: 6) {
      if seconds == stop { timer(stop, FITProfile.EventType.stop) }
      if seconds == restart { timer(seconds, FITProfile.EventType.start) }
      writer.message(
        local: 1, global: FITProfile.MessageNumber.record,
        [.uint32(timestamp, start + seconds), .uint16(FITProfile.RecordField.power, 200)])
    }
    timer(120, FITProfile.EventType.stopAll)
    return writer.file()
  }
}
