public enum WorkoutCopyResult: Equatable, Sendable {
  case stored(LibraryWorkout)
  case deletedOnTheServer
  case refused(reason: String)
}
