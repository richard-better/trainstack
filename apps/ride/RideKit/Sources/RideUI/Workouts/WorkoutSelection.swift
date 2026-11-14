import RideData
import RideStrava

enum WorkoutSelection: Hashable {
  case builtin(WorkoutTemplate.ID)
  case library(LibraryWorkout.ID)
}
