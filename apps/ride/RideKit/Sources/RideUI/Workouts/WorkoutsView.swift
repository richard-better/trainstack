import RideBluetooth
import RideData
import SwiftUI

/// The workout library. With room, a grid of cards with filters as pop-up buttons and one
/// Start button for the selected card. On iPhone, a list grouped by zone whose rows open each
/// workout, where it starts.
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
          .safeAreaBar(edge: .top) { WorkoutFilterBar(state: $state, count: shown.count) }
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

  /// On iPhone the search field sits under the title, revealed by pulling the list down. Kept
  /// always visible, it starts with the title collapsed.
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
