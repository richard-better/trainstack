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
    guard let today, var found = state?.range?.days.first(where: { $0.day == day }) else {
      return nil
    }
    found.planned = found.planned.map { $0.asOf(today) }
    return found
  }

  func week(startingOn monday: SettingDay) -> CalendarRange.Week? {
    state?.range?.weeks.first { $0.start == monday }
  }

  subscript(id: PlannedItem.ID) -> PlannedItem? {
    guard let today else { return nil }
    for day in state?.range?.days ?? [] {
      if let item = day.planned.first(where: { $0.id == id }) { return item.asOf(today) }
    }
    return nil
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
