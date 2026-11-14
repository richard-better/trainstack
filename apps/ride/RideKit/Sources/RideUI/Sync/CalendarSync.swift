import Foundation
import RideData
import RideStrava
import os

final class CalendarSync {
  static let rangeKeptFresh: TimeInterval = 15 * 60
  static let analysisChecked: TimeInterval = 30

  private let calendar: AccountCalendar
  private let server: any CalendarServer
  private let now: () -> Date
  private var rangeWanted = true
  private var heartbeat: Task<Void, Never>?
  private let log = Logger(subsystem: "com.trainstackhq.ride", category: "calendar-sync")
  private lazy var passes = SyncPasses(of: "Calendar", log: log) { [weak self] in
    try await self?.sync()
  }

  var onSignedOut: (() -> Void)? {
    get { passes.onSignedOut }
    set { passes.onSignedOut = newValue }
  }

  init(calendar: AccountCalendar, server: any CalendarServer, now: @escaping () -> Date = Date.init)
  {
    self.calendar = calendar
    self.server = server
    self.now = now
  }

  func start(checkingEvery interval: Duration = .seconds(60)) {
    syncSoon()
    heartbeat = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: interval)
        self?.checkSoon()
      }
    }
  }

  func accountChanged() {
    calendar.hide()
    rangeWanted = true
    passes.restart()
  }

  func accountDeleted(_ account: String) {
    calendar.forget(account)
    accountChanged()
  }

  func syncSoon() {
    rangeWanted = true
    passes.soon()
  }

  func checkSoon() {
    calendar.refreshToday()
    passes.soon()
  }

  func sync() async throws {
    guard let account = try await server.signedInAccount() else {
      try Task.checkCancellation()
      calendar.hide()
      throw StravaError.signedOut
    }
    try Task.checkCancellation()
    calendar.show(account.id)
    do {
      try await sync(for: account)
    } catch StravaError.signedOut {
      try Task.checkCancellation()
      if calendar.account == account.id { calendar.hide() }
      throw StravaError.signedOut
    }
  }

  private func sync(for account: ActivityAccount) async throws {
    let changes = try await server.plannedChanges(
      since: calendar.state?.plannedCursor, for: account)
    try checkStillSyncing(account)
    calendar.refreshToday()
    if needsRange(changed: changes.changed > 0) {
      rangeWanted = false
      do {
        try await readRange(for: account)
      } catch {
        rangeWanted = true
        throw error
      }
    }
    calendar.receive(plannedCursor: changes.cursor)
  }

  private func readRange(for account: ActivityAccount) async throws {
    let timeZone = try await server.athleteTimeZone(for: account)
    try checkStillSyncing(account)
    calendar.receive(timeZone: timeZone ?? TimeZone(identifier: "UTC")!)
    guard let window = calendar.window else { return }
    let range = try await server.calendar(
      from: window.from, through: window.through, for: account)
    try checkStillSyncing(account)
    calendar.receive(range)
    calendar.refreshToday()
  }

  private func needsRange(changed: Bool) -> Bool {
    guard !rangeWanted, !changed, let state = calendar.state, let range = state.range,
      let readAt = state.rangeReadAt, let today = calendar.today
    else { return true }
    let age = now().timeIntervalSince(readAt)
    if range.today != today || age >= Self.rangeKeptFresh || age < 0 { return true }
    return range.analysesDue > 0 && age >= Self.analysisChecked
  }

  private func checkStillSyncing(_ account: ActivityAccount) throws {
    try Task.checkCancellation()
    guard calendar.account == account.id else { throw CancellationError() }
  }
}
