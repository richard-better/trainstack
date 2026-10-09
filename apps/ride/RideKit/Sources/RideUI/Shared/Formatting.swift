import Foundation

extension TimeInterval {
  /// `30:00`, or `1:05:00` for rides of an hour or more, with the locale's separator.
  var clockString: String {
    let seconds = rounded()
    return Duration.seconds(seconds)
      .formatted(.time(pattern: seconds >= 3600 ? .hourMinuteSecond : .minuteSecond))
  }

  /// `13 sec`, `3 min`, `1 hr, 5 min`, in the rider's language. Rounded to the minute from a
  /// minute up.
  var spokenString: String {
    let seconds = rounded()
    let units: Set<Duration.UnitsFormatStyle.Unit> = seconds < 60 ? [.seconds] : [.hours, .minutes]
    return Duration.seconds(seconds).formatted(.units(allowed: units, width: .abbreviated))
  }
}

/// Pace as minutes and seconds, such as `4:05`, from a number of seconds. Parses minutes and
/// seconds with any separator, such as the `4.05` some locales write, or a plain number of
/// seconds.
nonisolated struct PaceFormat: ParseableFormatStyle {
  func format(_ seconds: Int) -> String {
    Duration.seconds(seconds).formatted(.time(pattern: .minuteSecond))
  }

  var parseStrategy: Strategy { Strategy() }

  struct Strategy: ParseStrategy {
    func parse(_ value: String) throws -> Int {
      let parts = value.trimmingCharacters(in: .whitespaces).split(
        omittingEmptySubsequences: false, whereSeparator: { !$0.isNumber })
      let numbers = parts.map { Int($0) }
      switch numbers.count {
      case 1: if let seconds = numbers[0] { return seconds }
      case 2:
        if let minutes = numbers[0], let seconds = numbers[1], (0..<60).contains(seconds) {
          let (wholeMinutes, minutesOverflow) = minutes.multipliedReportingOverflow(by: 60)
          let (total, secondsOverflow) = wholeMinutes.addingReportingOverflow(seconds)
          if !minutesOverflow, !secondsOverflow { return total }
        }
      default: break
      }
      throw CocoaError(.formatting)
    }
  }
}

extension FormatStyle where Self == PaceFormat {
  static var pace: PaceFormat { PaceFormat() }
}
