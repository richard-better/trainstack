import RideData
import RideStrava

struct TodayPlan: Equatable {
  static let daysAhead = 6

  let today: SettingDay
  let items: [PlannedItem]
  let upcoming: [CalendarRange.Day]

  init?(calendar: AccountCalendar) {
    guard calendar.isShowing, let today = calendar.today, let day = calendar.day(today) else {
      return nil
    }
    self.today = today
    items = day.planned
    upcoming = (1...Self.daysAhead).compactMap { calendar.day(today.adding(days: $0)) }
  }

  var firstToStart: PlannedItem? { items.first { $0.canStart && $0.state == .planned } }

  var headline: String {
    let workouts = items.filter(\.isWorkout)
    if workouts.isEmpty {
      return !items.isEmpty && items.allSatisfy(\.isRest)
        ? "Rest day" : "Nothing planned"
    }
    let toDo = workouts.filter { $0.state == .planned }
    if toDo.isEmpty {
      return workouts.allSatisfy { $0.state == .completed }
        ? "Done for today" : "Nothing left planned"
    }
    return toDo.count == 1 ? "1 workout planned" : "\(toDo.count) workouts planned"
  }
}
