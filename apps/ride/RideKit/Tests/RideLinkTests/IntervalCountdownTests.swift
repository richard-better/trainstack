import Testing

@testable import RideLink

struct IntervalCountdownTests {
  private func interval(_ index: Int, remaining: Double) -> RideGlance.Interval {
    .init(index: index, zone: .threshold, remaining: remaining, duration: 600)
  }

  /// The cues as an interval counts down from `start` seconds a second at a time.
  private func cues(from start: Int, isPaused: Bool = false) -> [Int: IntervalCue] {
    var countdown = IntervalCountdown()
    var cues: [Int: IntervalCue] = [:]
    for remaining in stride(from: start, through: 0, by: -1) {
      cues[remaining] = countdown.update(
        interval(1, remaining: Double(remaining)), isPaused: isPaused)
    }
    return cues
  }

  @Test func warnsTenSecondsAheadThenCountsTheLastThree() {
    #expect(cues(from: 20) == [10: .warning, 3: .count(3), 2: .count(2), 1: .count(1)])
  }

  @Test func staysQuietWhilePaused() {
    #expect(cues(from: 20, isPaused: true).isEmpty)
  }

  @Test func doesNotCueWhenSkippingIntoAnotherInterval() {
    var countdown = IntervalCountdown()
    #expect(countdown.update(interval(1, remaining: 300), isPaused: false) == nil)
    #expect(countdown.update(interval(2, remaining: 2), isPaused: false) == nil)
    #expect(countdown.update(interval(2, remaining: 1), isPaused: false) == .count(1))
  }

  @Test func aLateGlanceTapsOnlyForTheLatestSecond() {
    var countdown = IntervalCountdown()
    _ = countdown.update(interval(1, remaining: 4), isPaused: false)
    #expect(countdown.update(interval(1, remaining: 1.5), isPaused: false) == .count(2))
  }

  @Test func theFirstGlanceOfARideSetsNothingOff() {
    var countdown = IntervalCountdown()
    #expect(countdown.update(interval(0, remaining: 3), isPaused: false) == nil)
  }
}
