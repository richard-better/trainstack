import RideData
import RideStrava
import SwiftUI

struct WorkoutList: View {
  @Binding var state: WorkoutsState
  let shelves: [WorkoutShelf]
  let workouts: [WorkoutTemplate]
  let matchingCount: Int
  @Environment(RiderSettingsStore.self) private var settings

  var body: some View {
    List {
      WorkoutFilterChips(state: $state, matchingCount: matchingCount)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
      ForEach(shelves) { shelf in
        Section(shelf.title) {
          ForEach(shelf.workouts) { workout in
            NavigationLink(value: LibraryWorkoutRoute(id: workout.id)) {
              LibraryWorkoutRow(workout: workout, ftp: settings.ftp)
            }
          }
        }
      }
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
