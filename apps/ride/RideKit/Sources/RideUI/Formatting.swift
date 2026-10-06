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
