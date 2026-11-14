import Foundation
import RideData
import RideStrava

@testable import RideUI

actor FakeCalendarServer: CalendarServer {
  enum Call: Equatable {
    case timeZone(account: String)
    case range(from: String, through: String, account: String)
    case changes(since: String?, account: String)
    case write(PlannedWrite, account: String)
  }

  private struct Stamps {
    var placed: Date
    var skipped: Date
  }

  private struct Row {
    var item: PlannedItem?
    var revision: Int
  }

  private(set) var calls: [Call] = []
  private var stamps: [String: Stamps] = [:]
  private var choices: [String: [String: [String: (paired: Bool, at: Date)]]] = [:]
  private var rows: [String: [String: Row]] = [:]
  private var activities: [String: [SettingDay: [CalendarActivity]]] = [:]
  private var revisions: [String: Int] = [:]
  private var timeZones: [String: TimeZone] = [:]
  private var signedIn: ActivityAccount?
  private var offline = false
  private var analysesDue = 0
  private var clock: Date

  init(signedInAs account: String? = "ada", now: Date) {
    signedIn = account.map { ActivityAccount(id: $0, token: "token-\($0)") }
    clock = now
  }

  func signIn(as account: String?) {
    signedIn = account.map { ActivityAccount(id: $0, token: "token-\($0)") }
  }

  func goOffline(_ offline: Bool = true) { self.offline = offline }

  private var holdingWrites = false
  private var heldWrites: [CheckedContinuation<Void, Never>] = []

  func holdWrites() { holdingWrites = true }

  var isHoldingAWrite: Bool { !heldWrites.isEmpty }

  func releaseWrites() {
    holdingWrites = false
    for continuation in heldWrites { continuation.resume() }
    heldWrites = []
  }

  private var failingNextRange = false

  func failNextRange() { failingNextRange = true }

  func setClock(_ now: Date) { clock = now }

  func setTimeZone(_ zone: TimeZone, for account: String = "ada") { timeZones[account] = zone }

  func setAnalysesDue(_ count: Int) { analysesDue = count }

  var rangeReads: Int {
    calls.count { if case .range = $0 { true } else { false } }
  }

  private func nextRevision(_ account: String) -> Int {
    revisions[account, default: 0] += 1
    return revisions[account, default: 0]
  }

  func plan(_ item: PlannedItem, for account: String = "ada") {
    rows[account, default: [:]][item.id] = Row(item: item, revision: nextRevision(account))
  }

  func moveOnTheWeb(
    _ id: String, to day: SettingDay, at date: Date? = nil, for account: String = "ada"
  ) {
    _ = apply(.move(id: id, day: day, position: 0, updatedAt: date ?? clock), for: account)
  }

  func item(_ id: String, of account: String = "ada") -> PlannedItem? {
    rows[account]?[id]?.item
  }

  var writes: [PlannedWrite] {
    calls.compactMap { if case .write(let write, _) = $0 { write } else { nil } }
  }

  func deleteOnTheWeb(_ id: String, for account: String = "ada") {
    rows[account, default: [:]][id] = Row(item: nil, revision: nextRevision(account))
  }

  func record(_ activity: CalendarActivity, on day: SettingDay, for account: String = "ada") {
    activities[account, default: [:]][day, default: []].append(activity)
  }

  func signedInAccount() async throws -> ActivityAccount? { signedIn }

  private func check(_ account: ActivityAccount) throws {
    guard signedIn == account else { throw StravaError.signedOut }
    if offline { throw StravaError.unavailable }
  }

  private func zone(of account: String) -> TimeZone {
    timeZones[account] ?? TimeZone(identifier: "UTC")!
  }

  func athleteTimeZone(for account: ActivityAccount) async throws -> TimeZone? {
    try check(account)
    calls.append(.timeZone(account: account.id))
    return timeZones[account.id]
  }

  func calendar(from: SettingDay, through: SettingDay, for account: ActivityAccount) async throws
    -> CalendarRange
  {
    try check(account)
    if failingNextRange {
      failingNextRange = false
      throw StravaError.unavailable
    }
    calls.append(.range(from: from.text, through: through.text, account: account.id))
    let today = SettingDay(clock, in: zone(of: account.id))
    let live = (rows[account.id] ?? [:]).values.compactMap(\.item)
    let chosen = choices[account.id] ?? [:]
    var days: [CalendarRange.Day] = []
    var day = from
    while day <= through {
      let done = activities[account.id]?[day] ?? []
      let planned = live.filter { $0.day == day }.sorted {
        ($0.position, $0.id) < ($1.position, $1.id)
      }
      .map { item in
        var item = item
        let mine = chosen[item.id]?.first { $0.value.paired }?.key
        let refused = Set((chosen[item.id] ?? [:]).filter { !$0.value.paired }.keys)
        let auto = done.first { $0.plannedId == item.id && !refused.contains($0.id) }
        if let mine, done.contains(where: { $0.id == mine }) {
          item.pairing = .init(activityId: mine, by: .athlete)
        } else {
          item.pairing = auto.map { .init(activityId: $0.id, by: .auto) }
        }
        let paired = item.pairing
        item.state =
          paired != nil
          ? .completed
          : item.skipped != nil ? .skipped : item.isWorkout && day < today ? .missed : .planned
        return item
      }
      days.append(CalendarRange.Day(day: day, planned: planned, activities: done))
      day = day.adding(days: 1)
    }
    var weeks: [CalendarRange.Week] = []
    var monday = from.monday
    while monday <= through {
      weeks.append(CalendarRange.Week(start: monday))
      monday = monday.adding(days: 7)
    }
    return CalendarRange(today: today, days: days, weeks: weeks, analysesDue: analysesDue)
  }

  func send(_ write: PlannedWrite, for account: ActivityAccount) async throws
    -> PlannedWriteResult
  {
    try check(account)
    calls.append(.write(write, account: account.id))
    let result = apply(write, for: account.id)
    if holdingWrites { await withCheckedContinuation { heldWrites.append($0) } }
    return result
  }

  private func apply(_ write: PlannedWrite, for account: String) -> PlannedWriteResult {
    let id = write.plannedID
    guard let row = rows[account]?[id] else { return .refused(code: "NOT_FOUND") }
    guard var item = row.item else { return .deletedOnTheServer }
    let at: Date
    switch write {
    case .skip(_, _, let date), .unskip(_, let date), .move(_, _, _, let date),
      .pair(_, _, let date), .unpair(_, _, let date):
      at = date
    }
    if at > clock { return .refused(code: "EDITED_IN_THE_FUTURE") }
    let planned = item.updatedAt - 0.001
    var stamp = stamps[id] ?? Stamps(placed: planned, skipped: planned)
    switch write {
    case .skip(_, let reason, _):
      if at > stamp.skipped {
        item.skipped = .init(reason: reason)
        stamp.skipped = at
      }
    case .unskip:
      if at > stamp.skipped {
        item.skipped = nil
        stamp.skipped = at
      }
    case .move(_, let day, let position, _):
      if at > stamp.placed {
        item.day = day
        item.position = position
        stamp.placed = at
      }
    case .pair(_, let activityID, _):
      guard let activityDay = dayOf(activityID, for: account) else {
        return .refused(code: "ACTIVITY_NOT_FOUND")
      }
      guard item.isWorkout, activityDay == item.day else { return .refused(code: "NOT_PAIRABLE") }
      if choose(true, id, activityID, at, for: account) {
        item.pairing = .init(activityId: activityID, by: .athlete)
      }
    case .unpair(_, let activityID, _):
      guard dayOf(activityID, for: account) != nil else {
        return .refused(code: "ACTIVITY_NOT_FOUND")
      }
      if choose(false, id, activityID, at, for: account), item.pairing?.activityId == activityID {
        item.pairing = nil
      }
    }
    stamps[id] = stamp
    rows[account, default: [:]][id] = Row(item: item, revision: nextRevision(account))
    return .stored(item)
  }

  private func choose(
    _ paired: Bool, _ id: String, _ activityID: String, _ at: Date, for account: String
  ) -> Bool {
    if let earlier = choices[account]?[id]?[activityID], earlier.at >= at { return false }
    choices[account, default: [:]][id, default: [:]][activityID] = (paired, at)
    return true
  }

  private func dayOf(_ activityID: String, for account: String) -> SettingDay? {
    activities[account]?.first { $0.value.contains { $0.id == activityID } }?.key
  }

  func plannedChanges(since cursor: String?, for account: ActivityAccount) async throws
    -> PlannedChanges
  {
    try check(account)
    calls.append(.changes(since: cursor, account: account.id))
    let after = cursor.flatMap(Int.init) ?? 0
    let changed = (rows[account.id] ?? [:]).values.count { $0.revision > after }
    return PlannedChanges(
      changed: changed, cursor: String(max(after, revisions[account.id] ?? 0)))
  }
}
