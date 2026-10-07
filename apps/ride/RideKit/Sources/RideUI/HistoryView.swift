import RideData
import SwiftUI

/// Finished rides. With room to spare the list and the selected ride sit side by side, as in
/// Mail; otherwise the list pushes the ride full width.
struct HistoryView: View {
  @Bindable var library: RideLibrary
  @Binding var selection: Ride.ID?
  @State private var isImporting = false
  @State private var failures: [String] = []
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif

  /// Whether the list and the ride are on screen together, rather than one pushing the other.
  private var showsBothColumns: Bool {
    #if os(iOS)
      sizeClass == .regular
    #else
      true
    #endif
  }

  var body: some View {
    NavigationSplitView {
      List(selection: $selection) {
        ForEach(months, id: \.start) { month in
          Section(month.label) {
            ForEach(month.rides) { RideRow(ride: $0).tag($0.id) }
          }
        }
      }
      .overlay { emptyState }
      .navigationTitle("History")
      .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 420)
      .toolbar { importButton }
    } detail: {
      if let ride = library[selection] {
        detail(of: ride)
          .navigationTitle(ride.title)
          #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
          #endif
      } else {
        ContentUnavailableView("Select a ride", systemImage: "chart.xyaxis.line")
      }
    }
    // The split view always has a ride to show, like Mail's. On a phone, selecting one would
    // push it, so there the rider chooses.
    .onChange(of: library.rides.first?.id, initial: true) { _, newest in
      if showsBothColumns, selection == nil { selection = newest }
    }
    .onChange(of: showsBothColumns) { _, showsBothColumns in
      if showsBothColumns, selection == nil { selection = library.rides.first?.id }
    }
    .fileImporter(
      isPresented: $isImporting, allowedContentTypes: [.fitFile], allowsMultipleSelection: true
    ) { result in
      if case .success(let urls) = result { open(urls) }
    }
    .dropDestination(for: URL.self) { urls, _ in
      open(urls)
      return true
    }
    .alert("Couldn't open file", isPresented: failureAlert) {
    } message: {
      Text(failures.joined(separator: "\n"))
    }
  }

  private func detail(of ride: Ride) -> some View {
    ActivityDetailView(ride: ride) {
      selection = nil
      library.remove(ride.id)
    }
  }

  @ViewBuilder private var emptyState: some View {
    if library.rides.isEmpty {
      ContentUnavailableView {
        Label("No rides yet", systemImage: "clock")
      } description: {
        Text("Open a FIT file, or drop one here, to see how a ride went.")
      } actions: {
        Button("Open FIT File…") { isImporting = true }
      }
    }
  }

  private var importButton: some ToolbarContent {
    ToolbarItem {
      Button("Open FIT File", systemImage: "plus") { isImporting = true }
    }
  }

  private var failureAlert: Binding<Bool> {
    Binding(get: { !failures.isEmpty }, set: { if !$0 { failures = [] } })
  }

  private func open(_ urls: [URL]) {
    failures = library.open(urls)
  }

  private struct Month {
    let start: Date
    let rides: [Ride]
    var label: String { start.formatted(.dateTime.month(.wide).year()) }
  }

  private var months: [Month] {
    let calendar = Calendar.current
    let grouped = Dictionary(grouping: library.rides) {
      calendar.dateInterval(of: .month, for: $0.recording.startDate)?.start
        ?? $0.recording.startDate
    }
    return grouped.keys.sorted(by: >).map { Month(start: $0, rides: grouped[$0] ?? []) }
  }
}

private struct RideRow: View {
  let ride: Ride
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(ride.title).fontWeight(.semibold).lineLimit(1)
        Spacer(minLength: 0)
        Text(ride.recording.startDate.formatted(.dateTime.day().weekday(.abbreviated)))
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      HStack(spacing: 10) {
        Text(ride.recording.summary.duration.clockString)
        if let power = ride.recording.summary.averagePower { Text("\(power) W") }
        if let heartRate = ride.recording.summary.averageHeartRate { Text("\(heartRate) bpm") }
      }
      .font(.caption.monospacedDigit())
      .foregroundStyle(.secondary)
      zoneBar
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }

  /// Time in power zones when the rider has them, otherwise in heart rate zones.
  @ViewBuilder private var zoneBar: some View {
    let shown = [ZoneMetric.power, .heartRate].lazy.compactMap { metric in
      store.zones(for: metric, of: ride.recording).map {
        ride.recording.timeInZones($0, of: metric)
      }
    }
    if let shares = shown.first(where: { !$0.isEmpty }) {
      ZoneBar(shares: shares).frame(height: 4)
    }
  }
}

#Preview {
  @Previewable @State var selection: Ride.ID?
  HistoryView(library: .sample(), selection: $selection)
    .environment(RiderSettingsStore.sample)
    .frame(width: 1100, height: 760)
}
