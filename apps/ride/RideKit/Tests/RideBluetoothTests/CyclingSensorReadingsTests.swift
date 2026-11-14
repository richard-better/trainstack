import Foundation
import Testing

@testable import RideBluetooth

struct CyclingSensorReadingsTests {
  @Test func prefersPowerServiceAndDirectCadenceWithIndependentCounters() {
    var readings = CyclingSensorReadings()
    let now = Date.now
    readings.receive(Data([0x45, 0, 180, 0, 200, 0]), from: .indoorBike, at: now)
    readings.receive(Data([0x20, 0, 210, 0, 10, 0, 0, 0]), from: .power, at: now)
    readings.receive(
      Data([0x20, 0, 220, 0, 11, 0, 0, 4]), from: .power, at: now.addingTimeInterval(1))
    readings.receive(Data([2, 200, 0, 0, 0]), from: .speedAndCadence, at: now)
    readings.receive(
      Data([2, 202, 0, 0, 4]), from: .speedAndCadence, at: now.addingTimeInterval(1))
    #expect(readings.reading(for: .power, at: now.addingTimeInterval(1)) == 220)
    #expect(readings.reading(for: .cadence, at: now.addingTimeInterval(1)) == 90)
    #expect(readings.reading(for: .cadence, at: now.addingTimeInterval(5.5)) == 120)
  }

  @Test func powerFromACrankThatHasStoppedTurningGoesStale() {
    var readings = CyclingSensorReadings()
    let now = Date.now
    readings.receive(Data([0x20, 0, 200, 0, 10, 0, 0, 0]), from: .power, at: now)
    for second in 1...4 {
      readings.receive(
        Data([0x20, 0, 200, 0, 10, 0, 0, 0]), from: .power,
        at: now.addingTimeInterval(Double(second)))
    }
    #expect(readings.reading(for: .power, at: now.addingTimeInterval(4)) == 200)
    #expect(readings.reading(for: .power, at: now.addingTimeInterval(4), heardWithin: 2) == nil)
    readings.receive(
      Data([0x20, 0, 210, 0, 12, 0, 0, 4]), from: .power, at: now.addingTimeInterval(5))
    #expect(readings.reading(for: .power, at: now.addingTimeInterval(5), heardWithin: 2) == 210)
  }

  @Test func stalePowerStaysStaleAfterItExpires() {
    var readings = CyclingSensorReadings()
    let now = Date.now
    for second in 0...20 {
      let date = now.addingTimeInterval(Double(second))
      readings.receive(Data([0x20, 0, 200, 0, 10, 0, 0, 0]), from: .power, at: date)
      readings.expire(at: date)
      if second > Int(CyclingSensorReadings.maxAge) {
        #expect(readings.reading(for: .power, at: date) == nil)
      }
    }
  }

  @Test func zeroPowerFromAStillCrankIsCurrent() {
    var readings = CyclingSensorReadings()
    let now = Date.now
    for second in 0...6 {
      readings.receive(
        Data([0x20, 0, 0, 0, 10, 0, 0, 0]), from: .power, at: now.addingTimeInterval(Double(second))
      )
    }
    #expect(readings.reading(for: .power, at: now.addingTimeInterval(6), heardWithin: 2) == 0)
  }

  @Test func splitFtmsNotificationsPreserveOnlyRecentFields() {
    var readings = CyclingSensorReadings()
    let now = Date.now
    readings.receive(Data([0x41, 0, 200, 0]), from: .indoorBike, at: now)
    readings.receive(Data([0x05, 0, 180, 0]), from: .indoorBike, at: now.addingTimeInterval(1))
    #expect(readings.reading(for: .power, at: now.addingTimeInterval(1)) == 200)
    #expect(readings.reading(for: .cadence, at: now.addingTimeInterval(1)) == 90)
    #expect(readings.reading(for: .power, at: now.addingTimeInterval(6)) == nil)
    readings.expire(at: now.addingTimeInterval(7))
    #expect(readings.reading(for: .cadence, at: now.addingTimeInterval(7)) == nil)
  }

  @Test func malformedPacketsNeverReplaceAValidReading() {
    var readings = CyclingSensorReadings()
    let now = Date.now
    readings.receive(Data([0, 0, 200, 0]), from: .power, at: now)
    readings.receive(Data([0x20, 0, 100, 0]), from: .power, at: now)
    #expect(readings.reading(for: .power, at: now) == 200)
  }
}
