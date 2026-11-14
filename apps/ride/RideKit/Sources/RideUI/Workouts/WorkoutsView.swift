import RideBluetooth
import RideData
import RideStrava
import SwiftUI

struct WorkoutsView: View {
  @Binding var state: WorkoutsState
  @Environment(AccountWorkouts.self) private var accountWorkouts
  @Environment(RiderSettingsStore.self) private var settings
  @Environment(\.syncWorkouts) private var syncWorkouts
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif

  var body: some View {
    let shown = state.shown(in: WorkoutTemplate.library)
    let shelves = shelves
    let matchingCount = shown.count + Set(shelves.flatMap { $0.workouts.map(\.id) }).count
    Group {
      if isWide {
        WorkoutGrid(state: $state, shelves: shelves, shown: shown)
          .safeAreaBar(edge: .top) {
            WorkoutFilterBar(state: $state, matchingCount: matchingCount)
          }
          .toolbar {
            ToolbarItem(placement: .primaryAction) {
              let selected = selected(in: shown, shelves: shelves)
              StartButton(
                workout: selected?.workout,
                title: selected.map { "Start \($0.name)" } ?? "Start"
              )
              .labelStyle(.titleAndIcon)
              .buttonStyle(.borderedProminent)
            }
            #if os(iOS)
              .visibilityPriority(.high)
            #endif
          }
      } else {
        WorkoutList(
          state: $state, shelves: shelves, workouts: shown, matchingCount: matchingCount)
      }
    }
    .overlay {
      if matchingCount == 0 {
        ContentUnavailableView.search
      }
    }
    .navigationTitle("Workouts")
    .devicesToolbar()
    .searchable(text: $state.search, placement: searchPlacement, prompt: "Search")
    .refreshable { syncWorkouts() }
    .task { syncWorkouts() }
  }

  private var shelves: [WorkoutShelf] {
    let ftp = settings.ftp
    let mine = WorkoutShelf(
      id: "mine", title: "My Workouts",
      workouts: state.shown(in: accountWorkouts.workouts, ftp: ftp))
    let lists = accountWorkouts.lists.map { list in
      WorkoutShelf(
        id: list.id, title: list.name,
        workouts: state.filtered(accountWorkouts.workouts(in: list), ftp: ftp))
    }
    return ([mine] + lists).filter { !$0.workouts.isEmpty }
  }

  private func selected(in shown: [WorkoutTemplate], shelves: [WorkoutShelf]) -> (
    name: String, workout: PlannedWorkout?
  )? {
    switch state.selection {
    case .builtin(let id):
      return shown.first { $0.id == id }.map { ($0.name, $0.planned) }
    case .library(let id):
      return shelves.lazy.flatMap(\.workouts).first { $0.id == id }.map { ($0.name, $0.planned) }
    case nil:
      return nil
    }
  }

  private var searchPlacement: SearchFieldPlacement {
    #if os(iOS)
      isWide ? .automatic : .navigationBarDrawer
    #else
      .automatic
    #endif
  }

  private var isWide: Bool {
    #if os(iOS)
      sizeClass == .regular
    #else
      true
    #endif
  }
}

#Preview {
  @Previewable @State var state = WorkoutsState()
  NavigationStack {
    WorkoutsView(state: $state)
  }
  .environment(RideLauncher(simulated: true))
  .environment(RiderSettingsStore.sample)
  .environment(AccountWorkouts())
  .environment(BluetoothDevices.sample())
  .frame(width: 900, height: 780)
}
