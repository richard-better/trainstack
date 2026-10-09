import Foundation
import Testing

@testable import RideBluetooth

struct CyclingMeasurementTests {
  @Test func powerIsSignedAndZeroIsValid() {
    #expect(CyclingPowerMeasurement(Data([0, 0, 250, 0]))?.watts == 250)
    #expect(CyclingPowerMeasurement(Data([0, 0, 0, 0]))?.watts == 0)
    #expect(CyclingPowerMeasurement(Data([0, 0, 0xF6, 0xFF]))?.watts == -10)
  }

  @Test func locatesCrankDataAfterOptionalPowerFields() {
    let packet = Data([
      0x75, 0x0F, 250, 0,  // flags, power
      100, 20, 0,  // pedal balance, torque
      10, 0, 0, 0, 0, 4,  // wheel revolutions, wheel time
      42, 0, 0, 8,  // crank revolutions, crank time
      0, 0, 0, 0,  // extreme force
      0, 0, 0,  // extreme angles
      0, 0, 0, 0, 0, 0,  // top/bottom angles, energy
    ])
    let measurement = CyclingPowerMeasurement(packet)
    #expect(measurement?.watts == 250)
    #expect(measurement?.crank == CrankRevolution(count: 42, eventTime: 2048))
    for length in 0..<packet.count {
      #expect(CyclingPowerMeasurement(packet.prefix(length)) == nil)
    }
  }

  @Test func cscCanContainWheelAndCrankOrWheelOnly() {
    let packet = Data([3, 10, 0, 0, 0, 0, 4, 42, 0, 0, 8])
    #expect(
      CyclingSpeedCadenceMeasurement(packet)?.crank
        == CrankRevolution(count: 42, eventTime: 2048))
    #expect(CyclingSpeedCadenceMeasurement(Data([1, 10, 0, 0, 0, 0, 4]))?.crank == nil)
    for length in 0..<packet.count {
      #expect(CyclingSpeedCadenceMeasurement(packet.prefix(length)) == nil)
    }
  }

  @Test func indoorBikeHandlesEveryOptionalFieldAndHalfRpm() {
    let packet = Data([
      0xFE, 0x1F,  // every field, including speed
      0xB8, 0x0B, 0xB8, 0x0B,  // speed and average speed
      181, 0, 180, 0,  // cadence 90.5 rpm and average cadence
      1, 0, 0, 10, 0,  // distance, resistance
      250, 0, 240, 0,  // instantaneous and average power
      1, 0, 1, 0, 1,  // energy
      120, 10, 60, 0, 120, 0,  // HR, MET, elapsed and remaining time
    ])
    #expect(IndoorBikeMeasurement(packet)?.watts == 250)
    #expect(IndoorBikeMeasurement(packet)?.cadence == 91)
    for length in 0..<packet.count {
      #expect(IndoorBikeMeasurement(packet.prefix(length)) == nil)
    }
  }

  @Test func indoorBikeContinuationOmitsSpeedAndMissingMetricsAreNotZero() {
    #expect(IndoorBikeMeasurement(Data([0x41, 0, 0xF6, 0xFF]))?.watts == -10)
    #expect(IndoorBikeMeasurement(Data([0x41, 0, 0, 0]))?.cadence == nil)
    #expect(IndoorBikeMeasurement(Data([0x05, 0, 0, 0]))?.cadence == 0)
    #expect(IndoorBikeMeasurement(Data([0x05, 0, 0, 0]))?.watts == nil)
  }
}
