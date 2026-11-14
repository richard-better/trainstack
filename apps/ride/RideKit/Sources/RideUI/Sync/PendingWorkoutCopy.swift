import Foundation

struct PendingWorkoutCopy: Hashable, Codable {
  let id: String
  let builtin: String
  let updatedAt: Date
}
