import RideStrava

struct WorkoutShelf: Identifiable {
  let id: String
  let title: String
  let workouts: [LibraryWorkout]
}
