import Foundation

struct RideMonth: Identifiable {
  let start: Date
  let rides: [Ride]
  var id: Date { start }
  var label: String { start.formatted(.dateTime.month(.wide).year()) }

  static func grouping(_ rides: [Ride], calendar: Calendar) -> [RideMonth] {
    let grouped = Dictionary(grouping: rides) {
      calendar.dateInterval(of: .month, for: $0.recording.startDate)?.start
        ?? $0.recording.startDate
    }
    return grouped.keys.sorted(by: >).map { RideMonth(start: $0, rides: grouped[$0] ?? []) }
  }
}
