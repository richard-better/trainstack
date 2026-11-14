import RideData
import RideStrava

extension PlannedItem {
  func asOf(_ today: SettingDay) -> PlannedItem {
    guard state == .planned, isWorkout, skipped == nil, day < today else { return self }
    var missed = self
    missed.state = .missed
    return missed
  }
}
