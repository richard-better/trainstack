import CryptoKit
import Foundation
import Observation
import RideData
import RideStrava
import os

@Observable
final class AccountCalendar {
  private(set) var state: AccountCalendarState?
  private(set) var today: SettingDay?
  @ObservationIgnored var onEdit: (() -> Void)?
  @ObservationIgnored private let directory: URL
  @ObservationIgnored private let now: () -> Date
  @ObservationIgnored private let log = Logger(
    subsystem: "com.trainstackhq.ride", category: "calendar-sync")

  init(directory: URL = defaultDirectory, now: @escaping () -> Date = Date.init) {
    self.directory = directory
    self.now = now
  }

  static var defaultDirectory: URL {
    URL.applicationSupportDirectory.appending(path: "CalendarSync", directoryHint: .isDirectory)
  }

  var account: String? { state?.account }

  var isShowing: Bool { state?.range != nil && today != nil }

  func show(_ account: String) {
    guard state?.account != account else { return }
    state = load(account) ?? AccountCalendarState(account: account)
    refreshToday()
  }

  func hide() {
    state = nil
    today = nil
  }

  func forget(_ account: String) {
    try? FileManager.default.removeItem(at: url(of: account))
    if state?.account == account { hide() }
  }

  func refreshToday() {
    let day = state?.timeZone.map { SettingDay(now(), in: $0) } ?? state?.range?.today
    if day != today { today = day }
  }

  var window: CalendarWindow? { today.map(CalendarWindow.init(around:)) }

  func day(_ day: SettingDay) -> CalendarRange.Day? {
    guard let today, var found = shown?.days.first(where: { $0.day == day }) else {
      return nil
    }
    found.planned = found.planned.map { $0.asOf(today) }
    return found
  }

  func week(startingOn monday: SettingDay) -> CalendarRange.Week? {
    shown?.weeks.first { $0.start == monday }
  }

  subscript(id: PlannedItem.ID) -> PlannedItem? {
    guard let today else { return nil }
    for day in shown?.days ?? [] {
      if let item = day.planned.first(where: { $0.id == id }) { return item.asOf(today) }
    }
    return nil
  }

  private var shown: CalendarRange? {
    guard let state, let range = state.range else { return nil }
    guard !state.writes.isEmpty || !state.ridesToPair.isEmpty else { return range }
    return range.applying(state.writes, rides: state.ridesToPair, today: today ?? range.today)
  }

  func skip(_ id: PlannedItem.ID, reason: String?) {
    let reason = reason?.trimmingCharacters(in: .whitespacesAndNewlines)
    record(.skip(id: id, reason: reason?.isEmpty == false ? reason : nil, updatedAt: stamp()))
  }

  func unskip(_ id: PlannedItem.ID) {
    record(.unskip(id: id, updatedAt: stamp()))
  }

  func move(_ id: PlannedItem.ID, to day: SettingDay) {
    guard let item = self[id], item.day != day else { return }
    let last = self.day(day)?.planned.map(\.position).max()
    record(.move(id: id, day: day, position: last.map { $0 + 1 } ?? 0, updatedAt: stamp()))
  }

  func unpair(_ id: PlannedItem.ID) {
    guard let activityID = self[id]?.pairing?.activityId else { return }
    record(.unpair(id: id, activityId: activityID, updatedAt: stamp()))
  }

  func ride(of item: PlannedItem) -> PlannedRide? {
    account.map { PlannedRide(account: $0, plannedID: item.id) }
  }

  func rode(_ planned: PlannedRide, as rideID: String, startedAt: Date, endedAt: Date) {
    let shown = state?.account == planned.account
    var target =
      (shown ? state : load(planned.account)) ?? AccountCalendarState(account: planned.account)
    target.ridesToPair.append(
      PendingRidePairing(
        plannedID: planned.plannedID, rideID: rideID,
        rideDay: SettingDay(startedAt, in: target.timeZone ?? TimeZone(identifier: "UTC")!),
        endedAt: endedAt))
    guard shown else {
      keep(target)
      return
    }
    state = target
    keep(target)
    onEdit?()
  }

  func sent(_ write: PlannedWrite, storedAs stored: PlannedItem? = nil) {
    update { state in
      guard let index = state.writes.firstIndex(of: write) else { return }
      state.writes.remove(at: index)
      if let stored, let day = today ?? state.range?.today {
        state.range?.replace(with: stored.settled(today: day))
      }
    }
  }

  func forgetWrites(to id: PlannedItem.ID) {
    update { $0.writes.removeAll { $0.plannedID == id } }
  }

  func sent(_ ride: PendingRidePairing, storedAs stored: PlannedItem? = nil) {
    update { state in
      guard state.ridesToPair.contains(ride) else { return }
      state.ridesToPair.removeAll { $0 == ride }
      if let stored, let day = today ?? state.range?.today {
        state.range?.replace(with: stored.settled(today: day))
      }
    }
  }

  private func record(_ write: PlannedWrite) {
    if update({ $0.writes.append(write) }) { onEdit?() }
  }

  private func stamp() -> Date {
    let now = SettingStamp(now())
    let last = state?.lastStamp ?? .beforeAnyEdit
    let next = now > last ? now : last.next
    update { $0.lastStamp = next }
    return next.date
  }

  func receive(timeZone: TimeZone) {
    update { $0.timeZone = timeZone }
    refreshToday()
  }

  func receive(_ range: CalendarRange) {
    let readAt = now()
    update { state in
      state.range = range
      state.rangeReadAt = readAt
    }
  }

  func receive(plannedCursor: String) {
    update { $0.plannedCursor = plannedCursor }
  }

  @discardableResult
  private func update(_ change: (inout AccountCalendarState) -> Void) -> Bool {
    guard var state else { return false }
    change(&state)
    guard state != self.state else { return true }
    self.state = state
    keep(state)
    return true
  }

  private func load(_ account: String) -> AccountCalendarState? {
    (try? Data(contentsOf: url(of: account))).flatMap {
      try? JSONDecoder().decode(AccountCalendarState.self, from: $0)
    }
  }

  private func keep(_ state: AccountCalendarState) {
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try JSONEncoder().encode(state).write(to: url(of: state.account), options: .atomic)
    } catch {
      log.error("Calendar not saved: \(error.localizedDescription)")
    }
  }

  private func url(of account: String) -> URL {
    let name = SHA256.hash(data: Data(account.utf8)).map { String(format: "%02x", $0) }.joined()
    return directory.appending(path: "\(name).json")
  }
}
