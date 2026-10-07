import RideData
import SwiftUI

/// Finished rides. With room to spare the list and the selected ride sit side by side, as in
/// Mail; otherwise the list pushes the ride full width.
struct HistoryView: View {
  /// The content width from which the list and the ride are shown together. It is the width the
  /// content has after the sidebar, so hiding the sidebar can tip a window over this line.
  static let splitMinimumWidth: CGFloat = 1000
  private static let listWidth: CGFloat = 320

  @Bindable var library: RideLibrary
  @State private var selection: Ride.ID?
  @State private var path: [Ride.ID] = []
  @State private var width: CGFloat = 0
  @State private var isImporting = false
  @State private var failures: [String] = []

  private var isWide: Bool { width >= Self.splitMinimumWidth }

  var body: some View {
    Group {
      if isWide { splitLayout } else { stackLayout }
    }
    .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { width = $0 }
    .onChange(of: isWide) { _, isWide in
      // Keep the ride on screen when the window crosses the line.
      if isWide {
        selection = path.last ?? selection ?? library.rides.first?.id
      } else {
        path = selection.map { [$0] } ?? []
      }
    }
    // The split view always has a ride to show, like Mail's.
    .onChange(of: library.rides.first?.id) { _, newest in
      if isWide, selection == nil { selection = newest }
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

  private var splitLayout: some View {
    NavigationStack {
      HStack(spacing: 0) {
        List(selection: $selection) {
          ForEach(months, id: \.start) { month in
            Section(month.label) {
              ForEach(month.rides) { RideRow(ride: $0).tag($0.id) }
            }
          }
        }
        .overlay { emptyState }
        .frame(width: Self.listWidth)
        Divider()
        Group {
          if let ride = library[selection] {
            detail(of: ride)
          } else {
            ContentUnavailableView("Select a ride", systemImage: "chart.xyaxis.line")
          }
        }
        .frame(maxWidth: .infinity)
      }
      .navigationTitle("History")
      .toolbar { importButton }
    }
  }

  private var stackLayout: some View {
    NavigationStack(path: $path) {
      List {
        ForEach(months, id: \.start) { month in
          Section(month.label) {
            ForEach(month.rides) { ride in
              NavigationLink(value: ride.id) { RideRow(ride: ride) }
            }
          }
        }
      }
      .overlay { emptyState }
      .navigationTitle("History")
      .toolbar { importButton }
      .navigationDestination(for: Ride.ID.self) { id in
        if let ride = library[id] { detail(of: ride).navigationTitle(ride.title) }
      }
    }
  }

  private func detail(of ride: Ride) -> some View {
    ActivityDetailView(ride: ride) {
      selection = nil
      path = []
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
  @Environment(RiderProfileStore.self) private var profile

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
      profile.zones(for: metric).map { ($0, ride.recording.timeInZones($0, of: metric)) }
    }
    if let (zones, shares) = shown.first(where: { !$1.isEmpty }) {
      ZoneBar(zones: zones, shares: shares).frame(height: 4)
    }
  }
}

#Preview("Wide") {
  HistoryView(library: .sample())
    .environment(RiderProfileStore.sample)
    .frame(width: 1100, height: 760)
}

#Preview("Narrow") {
  HistoryView(library: .sample())
    .environment(RiderProfileStore.sample)
    .frame(width: 800, height: 760)
}
