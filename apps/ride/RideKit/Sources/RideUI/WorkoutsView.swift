import RideData
import SwiftUI

/// The workout library: filters as pop-up buttons, and one Start button for the selected card.
struct WorkoutsView: View {
  @Binding var state: WorkoutsState
  @Environment(RideLauncher.self) private var launcher
  @Environment(RiderSettingsStore.self) private var settings

  var body: some View {
    let shown = state.shown(in: WorkoutTemplate.library)
    ScrollView {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 14)], spacing: 14) {
        ForEach(shown) { template in
          WorkoutCard(
            template: template, isSelected: template.id == state.selection,
            select: { state.selection = template.id },
            start: settings.ftp.map { ftp in { launcher.start(template, ftp: ftp) } })
        }
      }
      .padding(24)
    }
    .overlay {
      if shown.isEmpty {
        ContentUnavailableView.search
      }
    }
    // The cards scroll under the filters, which sit on a soft edge rather than a rule.
    .safeAreaBar(edge: .top) { WorkoutFilterBar(state: $state, count: shown.count) }
    .navigationTitle("Workouts")
    .searchable(text: $state.search, prompt: "Search")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        StartButton(template: shown.first { $0.id == state.selection })
      }
    }
  }
}

#Preview {
  @Previewable @State var state = WorkoutsState()
  NavigationStack {
    WorkoutsView(state: $state)
  }
  .environment(RideLauncher(simulated: true))
  .environment(RiderSettingsStore.sample)
  .frame(width: 900, height: 780)
}
