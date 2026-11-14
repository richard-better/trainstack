import Foundation
import RideStrava
import os

final class WorkoutSync {
  private let workouts: AccountWorkouts
  private let server: any WorkoutServer
  private let log = Logger(subsystem: "com.trainstackhq.ride", category: "workout-sync")
  private lazy var passes = SyncPasses(of: "Workouts", log: log) { [weak self] in
    try await self?.sync()
  }

  var onSignedOut: (() -> Void)? {
    get { passes.onSignedOut }
    set { passes.onSignedOut = newValue }
  }

  init(workouts: AccountWorkouts, server: any WorkoutServer) {
    self.workouts = workouts
    self.server = server
  }

  func start() {
    workouts.onEdit = { [weak self] in self?.syncSoon() }
    syncSoon()
  }

  func accountChanged() {
    passes.restart()
  }

  func accountDeleted(_ account: String) {
    workouts.forget(account)
    accountChanged()
  }

  func syncSoon() {
    passes.soon()
  }

  func sync() async throws {
    guard let account = try await server.signedInAccount() else {
      try Task.checkCancellation()
      workouts.hide()
      throw StravaError.signedOut
    }
    try Task.checkCancellation()
    workouts.show(account.id)
    do {
      try await sync(for: account)
    } catch StravaError.signedOut {
      try Task.checkCancellation()
      if workouts.account == account.id { workouts.hide() }
      throw StravaError.signedOut
    }
  }

  private func sync(for account: ActivityAccount) async throws {
    for id in (workouts.state?.deletionsToSend ?? []).sorted() {
      try await server.deleteWorkout(id, for: account)
      try checkStillSyncing(account)
      workouts.deletionSent(id)
    }
    for copy in workouts.state?.copiesToSend ?? [] {
      let result = try await server.copyBuiltinWorkout(
        copy.builtin, as: copy.id, updatedAt: copy.updatedAt, for: account)
      try checkStillSyncing(account)
      workouts.copySent(copy, result: result)
    }
    let changes = try await server.workoutChanges(
      since: workouts.state?.workoutCursor, for: account)
    try checkStillSyncing(account)
    workouts.receive(changes)
    let lists = try await server.workoutListChanges(since: workouts.state?.listCursor, for: account)
    try checkStillSyncing(account)
    workouts.receive(lists)
  }

  private func checkStillSyncing(_ account: ActivityAccount) throws {
    try Task.checkCancellation()
    guard workouts.account == account.id else { throw CancellationError() }
  }
}
