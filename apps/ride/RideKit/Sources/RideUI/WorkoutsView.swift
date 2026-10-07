import RideData
import SwiftUI

/// The workout library: filters as pop-up buttons, and one Start button for the selected card.
struct WorkoutsView: View {
  @Environment(RideLauncher.self) private var launcher
  @Environment(RiderSettingsStore.self) private var settings
  @State private var selection: WorkoutTemplate.ID?
  @State private var search = ""
  @State private var duration = DurationFilter.any
  @State private var zone: PowerZone?
  @State private var stress = StressFilter.any
  @State private var order = Order.name

  private var library: [WorkoutTemplate] { WorkoutTemplate.library }

  var body: some View {
    ScrollView {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 14)], spacing: 14) {
        ForEach(shown) { template in
          WorkoutCard(
            template: template, isSelected: template.id == selection,
            select: { selection = template.id },
            start: settings.ftp.map { ftp in { launcher.start(template, ftp: ftp) } })
        }
      }
      .padding(24)
    }
    .overlay {
      if shown.isEmpty {
        ContentUnavailableView.search(text: search)
      }
    }
    // The cards scroll under the filters, which sit on a soft edge rather than a rule.
    .safeAreaBar(edge: .top) { filterBar }
    .navigationTitle("Workouts")
    .searchable(text: $search, prompt: "Search")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        StartButton(template: selected)
      }
    }
  }

  private var selected: WorkoutTemplate? {
    shown.first { $0.id == selection }
  }

  private var filterBar: some View {
    HStack(spacing: 8) {
      Picker("Duration", selection: $duration) {
        ForEach(DurationFilter.allCases, id: \.self) { Text($0.title).tag($0) }
      }
      Picker("Zone", selection: $zone) {
        Text("Any zone").tag(PowerZone?.none)
        Divider()
        ForEach(zones, id: \.self) { Text($0.name).tag(Optional($0)) }
      }
      Picker("Stress", selection: $stress) {
        ForEach(StressFilter.allCases, id: \.self) { Text($0.title).tag($0) }
      }
      Spacer()
      Text("^[\(shown.count) workout](inflect: true)")
        .foregroundStyle(.secondary)
      Picker("Sort", selection: $order) {
        ForEach(Order.allCases, id: \.self) { Text($0.title).tag($0) }
      }
      .labelsHidden()
      .help("Sort")
    }
    .pickerStyle(.menu)
    .labelsHidden()
    .fixedSize(horizontal: false, vertical: true)
    .font(.callout)
    .controlSize(.small)
    .padding(.horizontal, 24)
    .frame(minHeight: 44)
  }

  /// The zones the library has workouts for, easiest first.
  private var zones: [PowerZone] {
    PowerZone.allCases.filter { zone in library.contains { $0.category == zone } }
  }

  private var shown: [WorkoutTemplate] {
    library
      .filter { template in
        (search.isEmpty || template.name.localizedStandardContains(search))
          && duration.includes(template.duration)
          && (zone == nil || template.category == zone)
          && stress.includes(template.stressScore)
      }
      .sorted(by: order.areInIncreasingOrder)
  }

  private enum DurationFilter: CaseIterable {
    case any, short, medium, long

    var title: String {
      switch self {
      case .any: "Any duration"
      case .short: "Under 45 min"
      case .medium: "45–75 min"
      case .long: "Over 75 min"
      }
    }

    func includes(_ duration: TimeInterval) -> Bool {
      switch self {
      case .any: true
      case .short: duration < 45 * 60
      case .medium: (45 * 60...75 * 60).contains(duration)
      case .long: duration > 75 * 60
      }
    }
  }

  private enum StressFilter: CaseIterable {
    case any, low, medium, high

    var title: String {
      switch self {
      case .any: "Any stress"
      case .low: "Under 40 TSS"
      case .medium: "40–70 TSS"
      case .high: "Over 70 TSS"
      }
    }

    func includes(_ stress: Int) -> Bool {
      switch self {
      case .any: true
      case .low: stress < 40
      case .medium: (40...70).contains(stress)
      case .high: stress > 70
      }
    }
  }

  private enum Order: CaseIterable {
    case name, duration, stress

    var title: String {
      switch self {
      case .name: "Sort by Name"
      case .duration: "Sort by Duration"
      case .stress: "Sort by Stress"
      }
    }

    func areInIncreasingOrder(_ a: WorkoutTemplate, _ b: WorkoutTemplate) -> Bool {
      switch self {
      case .name: a.name.localizedStandardCompare(b.name) == .orderedAscending
      case .duration: (a.duration, a.name) < (b.duration, b.name)
      case .stress: (a.stressScore, a.name) < (b.stressScore, b.name)
      }
    }
  }
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
  NavigationStack {
    WorkoutsView()
  }
  .environment(RideLauncher(simulated: true))
  .environment(RiderSettingsStore.sample)
  .frame(width: 900, height: 780)
}
