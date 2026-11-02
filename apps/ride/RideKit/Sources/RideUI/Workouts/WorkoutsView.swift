import RideBluetooth
import RideData
import SwiftUI

struct WorkoutsView: View {
  @Binding var state: WorkoutsState
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif

  var body: some View {
    let shown = state.shown(in: WorkoutTemplate.library)
    Group {
      if isWide {
        WorkoutGrid(state: $state, shown: shown)
          .safeAreaBar(edge: .top) { WorkoutFilterBar(state: $state, matchingCount: shown.count) }
          .toolbar {
            ToolbarItem(placement: .primaryAction) {
              let selected = shown.first { $0.id == state.selection }
              StartButton(
                template: selected, title: selected.map { "Start \($0.name)" } ?? "Start"
              )
              .labelStyle(.titleAndIcon)
              .buttonStyle(.borderedProminent)
            }
            #if os(iOS)
              .visibilityPriority(.high)
            #endif
          }
      } else {
        WorkoutList(state: $state, workouts: shown)
      }
    }
    .overlay {
      if shown.isEmpty {
        ContentUnavailableView.search
      }
    }
    .navigationTitle("Workouts")
    .devicesToolbar()
    .searchable(text: $state.search, placement: searchPlacement, prompt: "Search")
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
  .environment(BluetoothDevices.sample())
  .frame(width: 900, height: 780)
}
