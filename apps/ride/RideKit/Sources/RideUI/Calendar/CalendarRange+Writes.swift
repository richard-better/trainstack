import RideData
import RideStrava

extension CalendarRange {
  func applying(_ writes: [PlannedWrite], rides: [PendingRidePairing], today: SettingDay)
    -> CalendarRange
  {
    var range = self
    for ride in rides {
      range.apply(
        .pair(id: ride.plannedID, activityId: ride.rideID, updatedAt: ride.endedAt), today: today)
    }
    for write in writes { range.apply(write, today: today) }
    return range
  }

  private mutating func apply(_ write: PlannedWrite, today: SettingDay) {
    guard let (dayIndex, itemIndex) = locate(write.plannedID) else { return }
    var item = days[dayIndex].planned[itemIndex]
    switch write {
    case .skip(_, let reason, _):
      item.skipped = .init(reason: reason)
    case .unskip:
      item.skipped = nil
    case .move(_, let day, let position, _):
      days[dayIndex].planned.remove(at: itemIndex)
      shiftPlanned(item.planned, from: item.day, to: day)
      item.day = day
      item.position = position
      item.pairing = nil
      item.compliance = nil
      guard let target = days.firstIndex(where: { $0.day == day }) else { return }
      days[target].planned.append(item.settled(today: today))
      days[target].planned.sort { ($0.position, $0.id) < ($1.position, $1.id) }
      return
    case .pair(_, let activityId, _):
      guard item.isWorkout, days[dayIndex].activities.contains(where: { $0.id == activityId })
      else { return }
      if item.pairing?.activityId != activityId { item.compliance = nil }
      item.pairing = .init(activityId: activityId, by: .athlete)
    case .unpair(_, let activityId, _):
      guard item.pairing?.activityId == activityId else { return }
      item.pairing = nil
      item.compliance = nil
    }
    days[dayIndex].planned[itemIndex] = item.settled(today: today)
  }

  mutating func replace(with stored: PlannedItem) {
    if let (dayIndex, itemIndex) = locate(stored.id) {
      let held = days[dayIndex].planned[itemIndex]
      shiftPlanned(held.planned, from: held.day, to: nil)
    }
    shiftPlanned(stored.planned, from: nil, to: stored.day)
    for index in days.indices { days[index].planned.removeAll { $0.id == stored.id } }
    guard let target = days.firstIndex(where: { $0.day == stored.day }) else { return }
    days[target].planned.append(stored)
    days[target].planned.sort { ($0.position, $0.id) < ($1.position, $1.id) }
  }

  private mutating func shiftPlanned(
    _ numbers: PlannedItem.Numbers?, from source: SettingDay?, to target: SettingDay?
  ) {
    guard let numbers else { return }
    let moved = Totals(
      seconds: numbers.seconds ?? 0, meters: numbers.meters ?? 0, load: numbers.load ?? 0)
    if let source { add(moved, times: -1, on: source) }
    if let target { add(moved, times: 1, on: target) }
  }

  private mutating func add(_ moved: Totals, times sign: Double, on day: SettingDay) {
    let change = { (totals: inout Totals) in
      totals.seconds += sign * moved.seconds
      totals.meters += sign * moved.meters
      totals.load += sign * moved.load
    }
    if let index = days.firstIndex(where: { $0.day == day }) {
      change(&days[index].totals.planned)
    }
    if let index = weeks.firstIndex(where: { $0.start == day.monday }) {
      change(&weeks[index].totals.planned)
    }
  }

  private func locate(_ id: PlannedItem.ID) -> (Int, Int)? {
    for (dayIndex, day) in days.enumerated() {
      if let itemIndex = day.planned.firstIndex(where: { $0.id == id }) {
        return (dayIndex, itemIndex)
      }
    }
    return nil
  }
}

extension PlannedItem {
  func settled(today: SettingDay) -> PlannedItem {
    var item = self
    item.state =
      if pairing != nil { .completed } else if skipped != nil {
        .skipped
      } else if isWorkout
        && day < today
      { .missed } else { .planned }
    return item
  }
}
