import Foundation

struct RideMonth: Identifiable {
  let start: Date
  let entries: [HistoryEntry]
  var id: Date { start }
  var label: String { start.formatted(.dateTime.month(.wide).year()) }

  static func grouping(_ entries: [HistoryEntry], calendar: Calendar) -> [RideMonth] {
    let grouped = Dictionary(grouping: entries) {
      calendar.dateInterval(of: .month, for: $0.date)?.start ?? $0.date
    }
    return grouped.keys.sorted(by: >).map { RideMonth(start: $0, entries: grouped[$0] ?? []) }
  }
}
