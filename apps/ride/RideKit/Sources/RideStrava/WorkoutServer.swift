import Foundation

public protocol WorkoutServer: Sendable {
  func signedInAccount() async throws -> ActivityAccount?
  func workoutChanges(since cursor: String?, for account: ActivityAccount) async throws
    -> WorkoutChanges
  func workoutListChanges(since cursor: String?, for account: ActivityAccount) async throws
    -> WorkoutListChanges
  func copyBuiltinWorkout(
    _ builtin: String, as id: String, updatedAt: Date, for account: ActivityAccount
  ) async throws -> WorkoutCopyResult
  func deleteWorkout(_ id: String, for account: ActivityAccount) async throws
}
