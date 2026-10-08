import RideData
import SwiftUI

/// The workout library as a list grouped by zone, small enough to scan on an iPhone. Each row
/// opens the workout, where the ride starts.
struct WorkoutList: View {
  @Binding var state: WorkoutsState
  /// The workouts that pass the filters.
  let workouts: [WorkoutTemplate]

  var body: some View {
    List {
      WorkoutFilterChips(state: $state, count: workouts.count)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
      ForEach(groups, id: \.zone) { group in
        Section {
          ForEach(group.workouts) { template in
            NavigationLink(value: template) {
              WorkoutRow(template: template, detail: template.shortSummary)
            }
          }
        } header: {
          ZoneLabel(zone: group.zone)
        }
      }
    }
    #if os(iOS)
      .listStyle(.insetGrouped)
    #endif
  }

  /// The workouts by the zone they train, easiest first, each keeping the chosen order.
  private var groups: [(zone: PowerZone, workouts: [WorkoutTemplate])] {
    let byZone = Dictionary(grouping: workouts, by: \.category)
    return PowerZone.allCases.compactMap { zone in byZone[zone].map { (zone, $0) } }
  }
}
