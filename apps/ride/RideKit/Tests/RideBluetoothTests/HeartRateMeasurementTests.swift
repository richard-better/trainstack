import Foundation
import Testing

@testable import RideBluetooth

struct HeartRateMeasurementTests {
  @Test func decodesEightBitHeartRate() {
    #expect(HeartRateMeasurement(Data([0x00, 72])) == .init(beatsPerMinute: 72))
  }

  @Test func decodesSixteenBitHeartRate() {
    #expect(HeartRateMeasurement(Data([0x01, 0x2C, 0x01])) == .init(beatsPerMinute: 300))
  }

  @Test func ignoresTrailingEnergyAndRRIntervals() {
    let data = Data([0x18, 140, 0x10, 0x00, 0xA0, 0x01])
    #expect(HeartRateMeasurement(data) == .init(beatsPerMinute: 140))
  }

  @Test func readsSkinContactOnlyWhenSupported() {
    #expect(HeartRateMeasurement(Data([0x06, 120]))?.hasContact == true)
    #expect(HeartRateMeasurement(Data([0x04, 120]))?.hasContact == false)
    #expect(HeartRateMeasurement(Data([0x02, 120]))?.hasContact == nil)
  }

  @Test func hasNoReadingWithoutContact() {
    #expect(HeartRateMeasurement(beatsPerMinute: 120, hasContact: false).reading == nil)
    #expect(HeartRateMeasurement(beatsPerMinute: 0).reading == nil)
    #expect(HeartRateMeasurement(beatsPerMinute: 120, hasContact: true).reading == 120)
  }

  @Test(arguments: [Data(), Data([0x00]), Data([0x01, 0x2C])])
  func rejectsTruncatedValues(data: Data) {
    #expect(HeartRateMeasurement(data) == nil)
  }

  @Test(arguments: [
    HeartRateMeasurement(beatsPerMinute: 72, hasContact: true),
    HeartRateMeasurement(beatsPerMinute: 300, hasContact: false),
    HeartRateMeasurement(beatsPerMinute: 255),
    HeartRateMeasurement(beatsPerMinute: 256),
  ])
  func roundTrips(measurement: HeartRateMeasurement) {
    #expect(HeartRateMeasurement(measurement.data) == measurement)
  }
}
