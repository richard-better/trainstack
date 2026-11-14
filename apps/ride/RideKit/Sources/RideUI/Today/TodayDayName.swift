import Foundation
import RideData

enum TodayDayName {
  static func of(_ day: SettingDay, today: SettingDay) -> String {
    switch today.days(until: day) {
    case 0: "Today"
    case 1: "Tomorrow"
    case -1: "Yesterday"
    default: day.displayDate.formatted(.dateTime.weekday(.abbreviated).day())
    }
  }
}
