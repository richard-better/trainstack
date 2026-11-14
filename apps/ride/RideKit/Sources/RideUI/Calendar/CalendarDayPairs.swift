import RideStrava

struct CalendarDayPairs: Equatable {
  struct Entry: Equatable, Identifiable {
    let item: PlannedItem
    let done: CalendarActivity?

    var id: PlannedItem.ID { item.id }
  }

  let planned: [Entry]
  let unplanned: [CalendarActivity]

  init(_ day: CalendarRange.Day) {
    let activities = Dictionary(day.activities.map { ($0.id, $0) }) { first, _ in first }
    var claimed: [String: PlannedItem.ID] = [:]
    let athleteFirst =
      day.planned.filter { $0.pairing?.by == .athlete }
      + day.planned.filter { $0.pairing?.by != .athlete }
    for item in athleteFirst {
      guard let activityID = item.pairing?.activityId, activities[activityID] != nil,
        claimed[activityID] == nil
      else { continue }
      claimed[activityID] = item.id
    }
    planned = day.planned.map { item in
      let activityID = item.pairing?.activityId
      let done = activityID.flatMap { claimed[$0] == item.id ? activities[$0] : nil }
      return Entry(item: item, done: done)
    }
    unplanned = day.activities.filter { claimed[$0.id] == nil }
  }
}
