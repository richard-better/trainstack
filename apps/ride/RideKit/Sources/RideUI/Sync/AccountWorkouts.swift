import CryptoKit
import Foundation
import Observation
import RideData
import RideStrava
import os

@Observable
final class AccountWorkouts {
  private(set) var state: AccountWorkoutsState?
  @ObservationIgnored var onEdit: (() -> Void)?
  @ObservationIgnored private let directory: URL
  @ObservationIgnored private let now: () -> Date
  @ObservationIgnored private let log = Logger(
    subsystem: "com.trainstackhq.ride", category: "workout-sync")

  init(directory: URL = defaultDirectory, now: @escaping () -> Date = Date.init) {
    self.directory = directory
    self.now = now
  }

  static var defaultDirectory: URL {
    URL.applicationSupportDirectory.appending(path: "WorkoutSync", directoryHint: .isDirectory)
  }

  var account: String? { state?.account }

  var workouts: [LibraryWorkout] {
    (state?.workouts.values).map { Array($0) } ?? []
  }

  var lists: [LibraryWorkoutList] {
    (state?.lists.values.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending })
      ?? []
  }

  subscript(id: LibraryWorkout.ID) -> LibraryWorkout? { state?.workouts[id] }

  func workouts(in list: LibraryWorkoutList) -> [LibraryWorkout] {
    list.workoutIDs.compactMap { state?.workouts[$0] }
  }

  func show(_ account: String) {
    guard state?.account != account else { return }
    state = load(account) ?? AccountWorkoutsState(account: account)
  }

  func hide() {
    state = nil
  }

  func forget(_ account: String) {
    try? FileManager.default.removeItem(at: url(of: account))
    if state?.account == account { state = nil }
  }

  @discardableResult
  func saveCopy(of template: WorkoutTemplate) -> LibraryWorkout.ID? {
    let id = UUID().uuidString.lowercased()
    let updatedAt = SettingStamp(now()).date
    guard
      let copy = try? LibraryWorkout(
        id: id, workout: template.trainStackWorkout, copiedFromBuiltin: template.builtinID,
        updatedAt: updatedAt)
    else { return nil }
    let changed = update { state in
      state.workouts[id] = copy
      state.copiesToSend.append(
        PendingWorkoutCopy(id: id, builtin: template.builtinID, updatedAt: updatedAt))
    }
    guard changed else { return nil }
    onEdit?()
    return id
  }

  func delete(_ id: LibraryWorkout.ID) {
    let changed = update { state in
      state.workouts[id] = nil
      state.copiesToSend.removeAll { $0.id == id }
      state.deleted.insert(id)
      state.deletionsToSend.insert(id)
      for listID in state.lists.keys { state.lists[listID]?.workoutIDs.removeAll { $0 == id } }
    }
    if changed { onEdit?() }
  }

  func deletionSent(_ id: String) {
    update { $0.deletionsToSend.remove(id) }
  }

  func copySent(_ copy: PendingWorkoutCopy, result: WorkoutCopyResult) {
    update { state in
      state.copiesToSend.removeAll { $0 == copy }
      switch result {
      case .stored(let workout):
        if !state.deleted.contains(workout.id) { state.workouts[workout.id] = workout }
      case .deletedOnTheServer:
        state.workouts[copy.id] = nil
        state.deleted.insert(copy.id)
      case .refused(let reason):
        state.workouts[copy.id] = nil
        log.error("TrainStack refused a copy of \(copy.builtin, privacy: .public): \(reason)")
      }
    }
  }

  func receive(_ changes: WorkoutChanges) {
    update { state in
      for workout in changes.workouts where !state.deleted.contains(workout.id) {
        state.workouts[workout.id] = workout
      }
      for id in changes.deleted {
        state.workouts[id] = nil
        state.deleted.insert(id)
        state.copiesToSend.removeAll { $0.id == id }
      }
      state.workoutCursor = changes.cursor
    }
  }

  func receive(_ changes: WorkoutListChanges) {
    update { state in
      for list in changes.lists {
        var list = list
        list.workoutIDs.removeAll(where: state.deleted.contains)
        state.lists[list.id] = list
      }
      for id in changes.deleted { state.lists[id] = nil }
      state.listCursor = changes.cursor
    }
  }

  @discardableResult
  private func update(_ change: (inout AccountWorkoutsState) -> Void) -> Bool {
    guard var state else { return false }
    change(&state)
    guard state != self.state else { return true }
    self.state = state
    keep(state)
    return true
  }

  private func load(_ account: String) -> AccountWorkoutsState? {
    (try? Data(contentsOf: url(of: account))).flatMap {
      try? JSONDecoder().decode(AccountWorkoutsState.self, from: $0)
    }
  }

  private func keep(_ state: AccountWorkoutsState) {
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try JSONEncoder().encode(state).write(to: url(of: state.account), options: .atomic)
    } catch {
      log.error("Workouts not saved: \(error.localizedDescription)")
    }
  }

  private func url(of account: String) -> URL {
    let name = SHA256.hash(data: Data(account.utf8)).map { String(format: "%02x", $0) }.joined()
    return directory.appending(path: "\(name).json")
  }
}
