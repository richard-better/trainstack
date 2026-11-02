import RideData
import SwiftUI

struct WorkoutList: View {
  @Binding var state: WorkoutsState
  let workouts: [WorkoutTemplate]

  var body: some View {
    List {
      WorkoutFilterChips(state: $state, matchingCount: workouts.count)
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

  private var groups: [(zone: PowerZone, workouts: [WorkoutTemplate])] {
    let byZone = Dictionary(grouping: workouts, by: \.category)
    return PowerZone.allCases.compactMap { zone in byZone[zone].map { (zone, $0) } }
  }
}
