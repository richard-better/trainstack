import Foundation
import Testing

@testable import RideData

struct HeartRateSelectorTests {
  private let start = Date(timeIntervalSinceReferenceDate: 0)

  @Test func prefersAChestStrapOverTheWatch() {
    var selector = HeartRateSelector()
    selector.record(.init(bpm: 152, source: .watch, date: start))
    selector.record(.init(bpm: 154, source: .chestStrap, date: start))
    #expect(selector.current(at: start)?.source == .chestStrap)
    #expect(selector.current(at: start)?.bpm == 154)
  }

  @Test func fallsBackToTheWatchWhenTheStrapGoesQuiet() {
    var selector = HeartRateSelector()
    selector.record(.init(bpm: 154, source: .chestStrap, date: start))
    selector.record(.init(bpm: 150, source: .watch, date: start + 8))
    #expect(selector.current(at: start + 10)?.source == .chestStrap)
    #expect(selector.current(at: start + 11)?.source == .watch)
    #expect(selector.current(at: start + 19) == nil)
  }

  @Test func keepsTheLatestReadingFromEachSourceAfterItGoesQuiet() {
    var selector = HeartRateSelector()
    #expect(selector.latest(from: .watch) == nil)
    selector.record(.init(bpm: 150, source: .watch, date: start))
    selector.record(.init(bpm: 154, source: .chestStrap, date: start + 1))
    #expect(selector.latest(from: .watch)?.date == start)
    #expect(selector.current(at: start + 60) == nil)
    #expect(selector.latest(from: .chestStrap)?.bpm == 154)
  }

  @Test func prefersRealSensorsOverASimulatedOne() {
    var selector = HeartRateSelector()
    selector.record(.init(bpm: 120, source: .simulated, date: start))
    #expect(selector.current(at: start)?.source == .simulated)
    selector.record(.init(bpm: 130, source: .watch, date: start))
    #expect(selector.current(at: start)?.source == .watch)
  }
}
