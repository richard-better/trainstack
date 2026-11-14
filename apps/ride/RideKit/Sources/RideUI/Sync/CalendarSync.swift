import Foundation
import RideData
import RideStrava
import os

final class CalendarSync {
  static let rangeKeptFresh: TimeInterval = 15 * 60
  static let analysisChecked: TimeInterval = 30
  static let ridesPairedWithin: TimeInterval = 30 * 24 * 3600

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
    calendar.onEdit = { [weak self] in self?.syncSoon() }
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
    try await sendWrites(for: account)
    try await pairRides(for: account)
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

  private func sendWrites(for account: ActivityAccount) async throws {
    while let write = calendar.state?.writes.first {
      let result = try await server.send(write, for: account)
      try checkStillSyncing(account)
      rangeWanted = true
      switch result {
      case .stored(let item):
        calendar.sent(write, storedAs: item)
      case .deletedOnTheServer, .refused(code: "NOT_FOUND"):
        calendar.forgetWrites(to: write.plannedID)
      case .refused(code: "EDITED_IN_THE_FUTURE"):
        log.error("TrainStack says this device's clock is ahead; the calendar edit waits")
        return
      case .refused(let code):
        log.error("TrainStack refused a calendar edit: \(code, privacy: .public)")
        calendar.sent(write)
      }
    }
  }

  private func pairRides(for account: ActivityAccount) async throws {
    for ride in calendar.state?.ridesToPair ?? [] {
      if now().timeIntervalSince(ride.endedAt) > Self.ridesPairedWithin {
        calendar.sent(ride)
        continue
      }
      let outcome = try await pair(ride, for: account)
      try checkStillSyncing(account)
      if case .done(let stored) = outcome { calendar.sent(ride, storedAs: stored) }
    }
  }

  private enum RidePairingOutcome {
    case waiting
    case done(PlannedItem?)
  }

  private func pair(_ ride: PendingRidePairing, for account: ActivityAccount) async throws
    -> RidePairingOutcome
  {
    let pair = PlannedWrite.pair(
      id: ride.plannedID, activityId: ride.rideID, updatedAt: ride.endedAt)
    switch try await server.send(pair, for: account) {
    case .stored(let paired):
      rangeWanted = true
      return .done(paired)
    case .refused(code: "NOT_PAIRABLE"):
      try checkStillSyncing(account)
      let back = PlannedWrite.move(
        id: ride.plannedID, day: ride.rideDay, position: 0, updatedAt: ride.endedAt)
      let moveResult = try await server.send(back, for: account)
      try checkStillSyncing(account)
      rangeWanted = true
      guard case .stored(let moved) = moveResult else { return .done(nil) }
      guard moved.day == ride.rideDay else { return .done(moved) }
      if case .stored(let paired) = try await server.send(pair, for: account) {
        return .done(paired)
      }
      return .done(moved)
    case .refused(code: "ACTIVITY_NOT_FOUND"), .refused(code: "EDITED_IN_THE_FUTURE"):
      return .waiting
    case .deletedOnTheServer, .refused:
      return .done(nil)
    }
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
