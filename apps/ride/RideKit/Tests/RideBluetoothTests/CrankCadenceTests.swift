import Foundation
import Testing

@testable import RideBluetooth

struct CrankCadenceTests {
  @Test func calculatesCadenceAcrossEventTimeAndCountRollover() {
    var cadence = CrankCadence()
    let now = Date.now
    #expect(cadence.update(.init(count: 65535, eventTime: 64682), at: now) == nil)
    #expect(
      cadence.update(.init(count: 1, eventTime: 512), at: now.addingTimeInterval(1.3)) == 90)
    #expect(
      cadence.update(.init(count: 2, eventTime: 1194), at: now.addingTimeInterval(2)) == 90)
  }

  @Test func duplicatePacketsPreserveCadenceBrieflyThenReportStopped() {
    var cadence = CrankCadence()
    let now = Date.now
    let crank = CrankRevolution(count: 11, eventTime: 1024)
    _ = cadence.update(.init(count: 10, eventTime: 0), at: now)
    #expect(cadence.update(crank, at: now.addingTimeInterval(1)) == 60)
    #expect(cadence.update(crank, at: now.addingTimeInterval(2)) == 60)
    #expect(cadence.update(crank, at: now.addingTimeInterval(4)) == 0)
  }

  @Test func stationarySensorCanReportZeroWithoutEverPedaling() {
    var cadence = CrankCadence()
    let now = Date.now
    let crank = CrankRevolution(count: 10, eventTime: 0)
    #expect(cadence.update(crank, at: now) == nil)
    #expect(cadence.update(crank, at: now.addingTimeInterval(3)) == 0)
  }

  @Test func resetsAndLongGapsDoNotProduceSpikes() {
    var cadence = CrankCadence()
    let now = Date.now
    _ = cadence.update(.init(count: 100, eventTime: 1000), at: now)
    #expect(cadence.update(.init(count: 1, eventTime: 1100), at: now.addingTimeInterval(1)) == nil)
    #expect(cadence.update(.init(count: 2, eventTime: 2124), at: now.addingTimeInterval(2)) == 60)
    #expect(cadence.update(.init(count: 3, eventTime: 3148), at: now.addingTimeInterval(15)) == nil)
    #expect(cadence.update(.init(count: 4, eventTime: 4172), at: now.addingTimeInterval(16)) == 60)
  }

  @Test func changingCountsWithNoEventTimeDoNotDivideByZero() {
    var cadence = CrankCadence()
    let now = Date.now
    _ = cadence.update(.init(count: 1, eventTime: 0), at: now)
    #expect(cadence.update(.init(count: 2, eventTime: 0), at: now.addingTimeInterval(1)) == nil)
  }
}
