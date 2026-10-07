import Foundation

/// The rides of one month in History.
struct RideMonth: Identifiable {
  let start: Date
  let rides: [Ride]
  var id: Date { start }
  var label: String { start.formatted(.dateTime.month(.wide).year()) }

  /// `rides` by the month they started in, newest month first, keeping their order within it.
  static func grouping(_ rides: [Ride], calendar: Calendar) -> [RideMonth] {
    let grouped = Dictionary(grouping: rides) {
      calendar.dateInterval(of: .month, for: $0.recording.startDate)?.start
        ?? $0.recording.startDate
    }
    return grouped.keys.sorted(by: >).map { RideMonth(start: $0, rides: grouped[$0] ?? []) }
  }
}
