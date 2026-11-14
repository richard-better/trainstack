import Foundation
import RideData
import RideStrava

@testable import RideUI

actor FakeWorkoutServer: WorkoutServer {
  enum Call: Equatable {
    case changes(since: String?, account: String)
    case listChanges(since: String?, account: String)
    case copy(builtin: String, id: String, account: String)
    case delete(id: String, account: String)
  }

  private struct Row {
    var workout: LibraryWorkout?
    var revision: Int
  }

  private struct ListRow {
    var list: LibraryWorkoutList?
    var revision: Int
  }

  private(set) var calls: [Call] = []
  private var rows: [String: [String: Row]] = [:]
  private var listRows: [String: [String: ListRow]] = [:]
  private var revisions: [String: Int] = [:]
  private var signedIn: ActivityAccount?
  private var offline = false
  private var losingTheNextAnswer = false
  private var holdingCopies = false
  private var held: [CheckedContinuation<Void, Never>] = []

  init(signedInAs account: String? = "ada") {
    signedIn = account.map { ActivityAccount(id: $0, token: "token-\($0)") }
  }

  func signIn(as account: String?, token: String? = nil) {
    signedIn = account.map { ActivityAccount(id: $0, token: token ?? "token-\($0)") }
  }

  private var holdingChanges = false
  private var heldChanges: [CheckedContinuation<Void, Never>] = []

  func holdChanges() { holdingChanges = true }

  var isHoldingChanges: Bool { !heldChanges.isEmpty }

  func releaseChanges() {
    holdingChanges = false
    for continuation in heldChanges { continuation.resume() }
    heldChanges = []
  }

  func goOffline(_ offline: Bool = true) { self.offline = offline }

  private var sessionExpired = false

  func expireTheSession() { sessionExpired = true }

  func loseTheNextAnswer() { losingTheNextAnswer = true }

  func holdCopies() { holdingCopies = true }

  var isHoldingACopy: Bool { !held.isEmpty }

  func releaseCopies() {
    holdingCopies = false
    for continuation in held { continuation.resume() }
    held = []
  }

  func workout(_ id: String, of account: String = "ada") -> LibraryWorkout? {
    rows[account]?[id]?.workout
  }

  func isDeleted(_ id: String, of account: String = "ada") -> Bool {
    rows[account]?[id].map { $0.workout == nil } ?? false
  }

  func liveWorkouts(of account: String = "ada") -> [LibraryWorkout] {
    (rows[account] ?? [:]).values.compactMap(\.workout).sorted { $0.id < $1.id }
  }

  private func nextRevision(_ account: String) -> Int {
    revisions[account, default: 0] += 1
    return revisions[account, default: 0]
  }

  @discardableResult
  func put(_ workout: LibraryWorkout, for account: String = "ada") -> LibraryWorkout? {
    if let row = rows[account]?[workout.id] {
      guard let current = row.workout else { return nil }
      guard
        (workout.updatedAt, String(decoding: workout.body, as: UTF8.self))
          > (current.updatedAt, String(decoding: current.body, as: UTF8.self))
      else { return current }
    }
    rows[account, default: [:]][workout.id] = Row(
      workout: workout, revision: nextRevision(account))
    return workout
  }

  func deleteOnTheWeb(_ id: String, for account: String = "ada") {
    guard rows[account]?[id]?.workout != nil || rows[account]?[id] == nil else { return }
    rows[account, default: [:]][id] = Row(workout: nil, revision: nextRevision(account))
    for (listID, row) in listRows[account] ?? [:] {
      guard var list = row.list, list.workoutIDs.contains(id) else { continue }
      list.workoutIDs.removeAll { $0 == id }
      listRows[account]?[listID] = ListRow(list: list, revision: nextRevision(account))
    }
  }

  func putList(_ list: LibraryWorkoutList, for account: String = "ada") {
    listRows[account, default: [:]][list.id] = ListRow(
      list: list, revision: nextRevision(account))
  }

  func signedInAccount() async throws -> ActivityAccount? { signedIn }

  private func check(_ account: ActivityAccount) throws {
    guard signedIn == account, !sessionExpired else { throw StravaError.signedOut }
    if offline { throw StravaError.unavailable }
  }

  private func answer() throws {
    guard losingTheNextAnswer else { return }
    losingTheNextAnswer = false
    throw StravaError.unavailable
  }

  func workoutChanges(since cursor: String?, for account: ActivityAccount) async throws
    -> WorkoutChanges
  {
    if holdingChanges {
      holdingChanges = false
      await withCheckedContinuation { heldChanges.append($0) }
    }
    try check(account)
    calls.append(.changes(since: cursor, account: account.id))
    let after = cursor.flatMap(Int.init) ?? 0
    let changed = (rows[account.id] ?? [:]).filter { $0.value.revision > after }
      .sorted { $0.value.revision < $1.value.revision }
    return WorkoutChanges(
      workouts: changed.compactMap(\.value.workout),
      deleted: changed.filter { $0.value.workout == nil }.map(\.key),
      cursor: String(max(after, revisions[account.id] ?? 0)))
  }

  func workoutListChanges(since cursor: String?, for account: ActivityAccount) async throws
    -> WorkoutListChanges
  {
    try check(account)
    calls.append(.listChanges(since: cursor, account: account.id))
    let after = cursor.flatMap(Int.init) ?? 0
    let changed = (listRows[account.id] ?? [:]).filter { $0.value.revision > after }
      .sorted { $0.value.revision < $1.value.revision }
    return WorkoutListChanges(
      lists: changed.compactMap(\.value.list),
      deleted: changed.filter { $0.value.list == nil }.map(\.key),
      cursor: String(max(after, revisions[account.id] ?? 0)))
  }

  func copyBuiltinWorkout(
    _ builtin: String, as id: String, updatedAt: Date, for account: ActivityAccount
  ) async throws -> WorkoutCopyResult {
    try check(account)
    calls.append(.copy(builtin: builtin, id: id, account: account.id))
    guard let template = WorkoutTemplate.builtin(builtin) else {
      return .refused(reason: "No such built-in workout")
    }
    let copy = try LibraryWorkout(
      id: id, workout: template.trainStackWorkout, copiedFromBuiltin: builtin,
      updatedAt: updatedAt)
    let stored = put(copy, for: account.id)
    if holdingCopies { await withCheckedContinuation { held.append($0) } }
    try answer()
    return stored.map(WorkoutCopyResult.stored) ?? .deletedOnTheServer
  }

  func deleteWorkout(_ id: String, for account: ActivityAccount) async throws {
    try check(account)
    calls.append(.delete(id: id, account: account.id))
    deleteOnTheWeb(id, for: account.id)
    try answer()
  }
}
