import RideData

nonisolated struct CalendarWindow: Equatable {
  static let daysEitherSide = 28

  let from: SettingDay
  let through: SettingDay

  init(around today: SettingDay) {
    from = today.adding(days: -Self.daysEitherSide).monday
    through = today.adding(days: Self.daysEitherSide).monday.adding(days: 6)
  }

  func contains(_ day: SettingDay) -> Bool { from <= day && day <= through }
}
