import Foundation
import RideData

enum CalendarWeekName {
  static func of(_ monday: SettingDay, today: SettingDay) -> String {
    switch today.monday.days(until: monday) / 7 {
    case 0: "This week"
    case -1: "Last week"
    case 1: "Next week"
    default:
      "\(monday.displayDate.formatted(.dateTime.day().month(.abbreviated))) – \(monday.adding(days: 6).displayDate.formatted(.dateTime.day().month(.abbreviated)))"
    }
  }
}
