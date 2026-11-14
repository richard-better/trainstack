public struct WorkoutChanges: Equatable, Sendable {
  public var workouts: [LibraryWorkout]
  public var deleted: [String]
  public var cursor: String

  public init(workouts: [LibraryWorkout], deleted: [String], cursor: String) {
    self.workouts = workouts
    self.deleted = deleted
    self.cursor = cursor
  }
}
