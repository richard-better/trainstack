import Foundation

extension TimeInterval {
  /// `30:00`, or `1:05:00` for rides of an hour or more.
  var clockString: String {
    let total = Int(rounded())
    let (hours, minutes, seconds) = (total / 3600, total / 60 % 60, total % 60)
    return hours > 0
      ? String(format: "%d:%02d:%02d", hours, minutes, seconds)
      : String(format: "%d:%02d", minutes, seconds)
  }

  /// `13 s`, `3 min`, `1 h 5 min`.
  var spokenString: String {
    let total = Int(rounded())
    if total < 60 { return "\(total) s" }
    let minutes = Int((self / 60).rounded())
    return minutes < 60 ? "\(minutes) min" : "\(minutes / 60) h \(minutes % 60) min"
  }
}

/// Pace as minutes and seconds, such as `4:05`, from a number of seconds. Parses `4:05`, or a
/// plain number of seconds.
nonisolated struct PaceFormat: ParseableFormatStyle {
  func format(_ seconds: Int) -> String {
    String(format: "%d:%02d", seconds / 60, seconds % 60)
  }

  var parseStrategy: Strategy { Strategy() }

  struct Strategy: ParseStrategy {
    func parse(_ value: String) throws -> Int {
      let parts = value.trimmingCharacters(in: .whitespaces).split(
        separator: ":", omittingEmptySubsequences: false)
      let numbers = parts.map { Int($0) }
      switch numbers.count {
      case 1: if let seconds = numbers[0] { return seconds }
      case 2:
        if let minutes = numbers[0], let seconds = numbers[1], (0..<60).contains(seconds) {
          return minutes * 60 + seconds
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
