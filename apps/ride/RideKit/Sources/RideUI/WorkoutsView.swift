import RideData
import SwiftUI

/// The workout library: filters as pop-up buttons, and one Start button for the selected card.
struct WorkoutsView: View {
  @Environment(RideLauncher.self) private var launcher
  @Environment(RiderSettingsStore.self) private var settings
  @Binding var state: WorkoutsState

  private var library: [WorkoutTemplate] { WorkoutTemplate.library }

  var body: some View {
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
        ContentUnavailableView.search(text: state.search)
      }
    }
    // The cards scroll under the filters, which sit on a soft edge rather than a rule.
    .safeAreaBar(edge: .top) { filterBar }
    .navigationTitle("Workouts")
    .searchable(text: $state.search, prompt: "Search")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        StartButton(template: selected)
      }
    }
  }

  private var selected: WorkoutTemplate? {
    shown.first { $0.id == state.selection }
  }

  /// One row when it fits, otherwise the same row scrolling sideways.
  private var filterBar: some View {
    ViewThatFits(in: .horizontal) {
      filters
      ScrollView(.horizontal) { filters }
        .scrollIndicators(.hidden)
    }
    .frame(minHeight: 44)
  }

  private var filters: some View {
    HStack(spacing: 8) {
      Picker("Duration", selection: $state.duration) {
        ForEach(WorkoutDurationFilter.allCases, id: \.self) { Text($0.title).tag($0) }
      }
      .fixedSize()
      Picker("Zone", selection: $state.zone) {
        Text("Any zone").tag(PowerZone?.none)
        Divider()
        ForEach(zones, id: \.self) { Text($0.name).tag(Optional($0)) }
      }
      .fixedSize()
      Picker("Stress", selection: $state.stress) {
        ForEach(WorkoutStressFilter.allCases, id: \.self) { Text($0.title).tag($0) }
      }
      .fixedSize()
      Spacer()
      Text("^[\(shown.count) workout](inflect: true)")
        .foregroundStyle(.secondary)
        .fixedSize()
      Picker("Sort", selection: $state.order) {
        ForEach(WorkoutOrder.allCases, id: \.self) { Text($0.title).tag($0) }
      }
      .labelsHidden()
      .fixedSize()
      .help("Sort")
    }
    .pickerStyle(.menu)
    .labelsHidden()
    .font(.callout)
    .controlSize(.small)
    .padding(.horizontal, 24)
  }

  /// The zones the library has workouts for, easiest first.
  private var zones: [PowerZone] {
    PowerZone.allCases.filter { zone in library.contains { $0.category == zone } }
  }

  private var shown: [WorkoutTemplate] { state.shown(in: library) }
}

/// Starts the selected workout. Return starts it too. Targets are set from FTP, so without one
/// there is nothing to start.
struct StartButton: View {
  let template: WorkoutTemplate?
  var title: String = "Start"
  @Environment(RideLauncher.self) private var launcher
  @Environment(RiderSettingsStore.self) private var settings

  var body: some View {
    Button(title) {
      if let template, let ftp = settings.ftp { launcher.start(template, ftp: ftp) }
    }
    .buttonStyle(.borderedProminent)
    .keyboardShortcut(.defaultAction)
    .disabled(template == nil || settings.ftp == nil || launcher.ride != nil)
    .help(help)
  }

  private var help: String {
    if settings.ftp == nil { return "Add your FTP in Settings to ride a workout." }
    return launcher.ride == nil ? "" : "End the ride in progress to start another."
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
