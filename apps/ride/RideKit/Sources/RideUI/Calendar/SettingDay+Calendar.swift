import Foundation
import RideData

nonisolated extension SettingDay {
  private static let utc: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
  }()

  init(_ date: Date, in timeZone: TimeZone) {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    self.init(date, calendar: calendar)
  }

  func adding(days: Int) -> SettingDay {
    let moved = Self.utc.date(byAdding: .day, value: days, to: date(in: Self.utc)) ?? .distantPast
    return SettingDay(moved, calendar: Self.utc)
  }

  func days(until other: SettingDay) -> Int {
    Self.utc.dateComponents([.day], from: date(in: Self.utc), to: other.date(in: Self.utc)).day
      ?? 0
  }

  var monday: SettingDay {
    let weekday = Self.utc.component(.weekday, from: date(in: Self.utc))
    return adding(days: -((weekday + 5) % 7))
  }

  var displayDate: Date { date(in: .current) }
}
