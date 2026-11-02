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
    let flags: [UInt8] = [0x75, 0x0F]
    let power: [UInt8] = [250, 0]
    let pedalBalanceAndTorque: [UInt8] = [100, 20, 0]
    let wheelRevolutionsAndTime: [UInt8] = [10, 0, 0, 0, 0, 4]
    let crankRevolutionsAndTime: [UInt8] = [42, 0, 0, 8]
    let extremeForces: [UInt8] = [0, 0, 0, 0]
    let extremeAngles: [UInt8] = [0, 0, 0]
    let deadSpotAnglesAndEnergy: [UInt8] = [0, 0, 0, 0, 0, 0]
    let packet = Data(
      [
        flags, power, pedalBalanceAndTorque, wheelRevolutionsAndTime, crankRevolutionsAndTime,
        extremeForces, extremeAngles, deadSpotAnglesAndEnergy,
      ].joined())
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
    let everyFieldIncludingSpeed: [UInt8] = [0xFE, 0x1F]
    let speedAndAverageSpeed: [UInt8] = [0xB8, 0x0B, 0xB8, 0x0B]
    let cadenceOf90AndAHalfAndAverageCadence: [UInt8] = [181, 0, 180, 0]
    let distanceAndResistance: [UInt8] = [1, 0, 0, 10, 0]
    let powerAndAveragePower: [UInt8] = [250, 0, 240, 0]
    let energy: [UInt8] = [1, 0, 1, 0, 1]
    let heartRateMetAndElapsedAndRemainingTime: [UInt8] = [120, 10, 60, 0, 120, 0]
    let packet = Data(
      [
        everyFieldIncludingSpeed, speedAndAverageSpeed, cadenceOf90AndAHalfAndAverageCadence,
        distanceAndResistance, powerAndAveragePower, energy,
        heartRateMetAndElapsedAndRemainingTime,
      ].joined())
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
