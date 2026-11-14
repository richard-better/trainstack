import Foundation
import RideLink

extension RideGlance.Interval {
  func remainingClock(minutesOnly: Bool) -> String {
    let seconds = elapsedUntilLap.map { $0.rounded(.down) } ?? remaining.rounded(.up)
    let clock = Duration.seconds(seconds).formatted(.time(pattern: .minuteSecond))
    guard minutesOnly, let separator = clock.lastIndex(where: { !$0.isNumber }) else {
      return clock
    }
    return clock[...separator] + "–"
  }
}
