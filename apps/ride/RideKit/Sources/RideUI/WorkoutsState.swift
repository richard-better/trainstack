import RideData

/// What the rider has chosen on the Workouts page. Held above the tabs, so it survives Settings
/// taking over the sidebar.
struct WorkoutsState: Equatable {
  var selection: WorkoutTemplate.ID?
  var search = ""
  var duration = WorkoutDurationFilter.any
  var zone: PowerZone?
  var stress = WorkoutStressFilter.any
  var order = WorkoutOrder.name

  /// The workouts in `library` that pass the filters, in the chosen order.
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
}
