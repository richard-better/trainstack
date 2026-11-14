import Foundation

public struct LibraryWorkoutList: Hashable, Codable, Identifiable, Sendable {
  public let id: String
  public var name: String
  public var workoutIDs: [String]
  public var updatedAt: Date

  public init(id: String, name: String, workoutIDs: [String], updatedAt: Date) {
    self.id = id
    self.name = name
    self.workoutIDs = workoutIDs
    self.updatedAt = updatedAt
  }
}
