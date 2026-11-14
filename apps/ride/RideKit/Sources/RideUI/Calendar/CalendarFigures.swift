import Foundation

enum CalendarFigures {
  static func hours(_ seconds: Double) -> String {
    let minutes = Int((seconds / 60).rounded())
    let hours = minutes / 60
    return hours > 0 ? String(format: "%dh %02dm", hours, minutes % 60) : "\(minutes)m"
  }

  static func distance(_ meters: Double) -> String {
    if meters < 1000 { return "\(Int(meters.rounded())) m" }
    return String(format: meters < 100_000 ? "%.2f km" : "%.1f km", meters / 1000)
  }

  static func load(_ load: Double) -> String { "\(Int(load.rounded()))" }
}
