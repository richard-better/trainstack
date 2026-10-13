import Foundation
import Testing

@testable import RideData

struct PowerAverageTests {
  private func average(of readings: [Int?], each duration: TimeInterval = 1) -> PowerAverage {
    var average = PowerAverage()
    for power in readings { average.record(power, over: duration) }
    return average
  }

  @Test func instantIsTheLatestReading() {
    #expect(average(of: [200, 210, 180]).average(over: PowerDisplay.instant.window) == 180)
    #expect(average(of: [200, nil]).average(over: 0) == nil)
    #expect(PowerAverage().average(over: 3) == nil)
  }

  @Test func averagesTheLastThreeSeconds() {
    let readings = average(of: [500, 200, 220, 240])
    #expect(readings.average(over: 3) == 220)
    #expect(readings.average(over: 5) == 290)
  }

  @Test func countsZerosFromStoppingPedalling() {
    #expect(average(of: [240, 0, 0]).average(over: 3) == 80)
    #expect(average(of: [240, 240, 0]).average(over: 3) == 160)
  }

  @Test func forgetsReadingsOlderThanTheWindow() {
    var readings = average(of: [1_000, 1_000, 1_000, 1_000, 1_000])
    for _ in 0..<5 { readings.record(100, over: 1) }
    #expect(readings.average(over: 5) == 100)
    #expect(readings.average(over: 30) == 100)
  }

  @Test func weighsReadingsByTheTimeTheyCover() {
    var readings = PowerAverage()
    readings.record(300, over: 2)
    readings.record(150, over: 1)
    #expect(readings.average(over: 3) == 250)
    // Only the last second of a two-second reading falls in a two-second window.
    #expect(readings.average(over: 2) == 225)
    readings.record(0, over: 0.5)
    readings.record(0, over: 0.5)
    #expect(readings.average(over: 3) == 150)
  }

  @Test func leavesMissingReadingsOut() {
    #expect(average(of: [200, nil, 260]).average(over: 3) == 230)
    #expect(average(of: [200, nil, nil]).average(over: 3) == 200)
    #expect(average(of: [200, nil, nil, nil]).average(over: 3) == nil)
  }

  @Test func savesTheChoice() throws {
    let name = "PowerDisplayTests-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: name))
    defer { defaults.removePersistentDomain(forName: name) }
    #expect(PowerDisplay.load(from: defaults) == .threeSeconds)
    PowerDisplay.fiveSeconds.save(to: defaults)
    #expect(PowerDisplay.load(from: defaults) == .fiveSeconds)
  }
}
