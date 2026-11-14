import Foundation
import RideData
import RideStrava

@testable import RideUI

actor FakeCalendarServer: CalendarServer {
  enum Call: Equatable {
    case timeZone(account: String)
    case range(from: String, through: String, account: String)
    case changes(since: String?, account: String)
  }

  private struct Row {
    var item: PlannedItem?
    var revision: Int
  }

  private(set) var calls: [Call] = []
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

  func moveOnTheWeb(_ id: String, to day: SettingDay, for account: String = "ada") {
    guard var item = rows[account]?[id]?.item else { return }
    item.day = day
    plan(item, for: account)
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
    calls.append(.range(from: from.text, through: through.text, account: account.id))
    let today = SettingDay(clock, in: zone(of: account.id))
    let live = (rows[account.id] ?? [:]).values.compactMap(\.item)
    var days: [CalendarRange.Day] = []
    var day = from
    while day <= through {
      let done = activities[account.id]?[day] ?? []
      let planned = live.filter { $0.day == day }.sorted {
        ($0.position, $0.id) < ($1.position, $1.id)
      }
      .map { item in
        var item = item
        let paired = done.first { $0.plannedId == item.id }
        item.pairing = paired.map { .init(activityId: $0.id, by: .auto) }
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
