import Foundation

extension TimeInterval {
  var clockString: String {
    let seconds = rounded()
    return Duration.seconds(seconds)
      .formatted(.time(pattern: seconds >= 3600 ? .hourMinuteSecond : .minuteSecond))
  }

  var spokenString: String {
    let seconds = rounded()
    let units: Set<Duration.UnitsFormatStyle.Unit> = seconds < 60 ? [.seconds] : [.hours, .minutes]
    return Duration.seconds(seconds).formatted(.units(allowed: units, width: .abbreviated))
  }
}

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
