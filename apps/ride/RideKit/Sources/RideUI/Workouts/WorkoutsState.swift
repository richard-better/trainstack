import RideData
import RideStrava

struct WorkoutsState: Equatable {
  var selection: WorkoutSelection?
  var search = ""
  var duration = WorkoutDurationFilter.any
  var zone: PowerZone?
  var stress = WorkoutStressFilter.any
  var order = WorkoutOrder.name

  func shown(in library: [WorkoutTemplate]) -> [WorkoutTemplate] {
    library
      .filter { template in
        (search.isEmpty || template.name.localizedStandardContains(search))
          && duration.includes(template.duration)
          && (zone == nil || template.category == zone)
          && stress.includes(template.stressScore)
      }
      .sorted(by: order.areInIncreasingOrder)
  }

  func shown(in workouts: [LibraryWorkout], ftp: Int?) -> [LibraryWorkout] {
    filtered(workouts, ftp: ftp).sorted { order.areInIncreasingOrder($0, $1, ftp: ftp) }
  }

  func filtered(_ workouts: [LibraryWorkout], ftp: Int?) -> [LibraryWorkout] {
    workouts.filter { workout in
      workout.matches(search)
        && (duration == .any
          || (!workout.hasLapSteps && workout.duration.map(duration.includes) == true))
        && (zone == nil || workout.zone == zone)
        && (stress == .any || workout.planned?.stressScore(ftp: ftp).map(stress.includes) == true)
    }
  }
}
