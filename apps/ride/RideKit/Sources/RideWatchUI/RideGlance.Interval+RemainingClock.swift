import Foundation
import RideLink

extension RideGlance.Interval {
  func remainingClock(minutesOnly: Bool) -> String {
    let clock = Duration.seconds(remaining.rounded(.up)).formatted(.time(pattern: .minuteSecond))
    guard minutesOnly, let separator = clock.lastIndex(where: { !$0.isNumber }) else {
      return clock
    }
    return clock[...separator] + "–"
  }
}
