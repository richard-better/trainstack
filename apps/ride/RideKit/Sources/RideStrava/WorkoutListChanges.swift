public struct WorkoutListChanges: Equatable, Sendable {
  public var lists: [LibraryWorkoutList]
  public var deleted: [String]
  public var cursor: String

  public init(lists: [LibraryWorkoutList], deleted: [String], cursor: String) {
    self.lists = lists
    self.deleted = deleted
    self.cursor = cursor
  }
}
