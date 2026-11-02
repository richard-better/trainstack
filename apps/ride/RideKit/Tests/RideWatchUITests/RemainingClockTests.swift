import RideLink
import Testing

@testable import RideWatchUI

struct RemainingClockTests {
  private func interval(remaining: Double) -> RideGlance.Interval {
    .init(index: 0, zone: .threshold, remaining: remaining, duration: 720)
  }

  @Test func showsMinutesAndSecondsLeft() {
    #expect(interval(remaining: 522).remainingClock(minutesOnly: false) == "8:42")
  }

  @Test func roundsPartSecondsUp() {
    #expect(interval(remaining: 521.2).remainingClock(minutesOnly: false) == "8:42")
    #expect(interval(remaining: 0.4).remainingClock(minutesOnly: false) == "0:01")
  }

  @Test func showsOnlyTheMinutesLeftWristDown() {
    #expect(interval(remaining: 522).remainingClock(minutesOnly: true) == "8:–")
  }
}
