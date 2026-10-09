import RideData
import SwiftUI

/// Finished rides. With room to spare the list and the selected ride sit side by side, as in
/// Mail; otherwise the list pushes the ride full width.
struct HistoryView: View {
  let library: RideLibrary
  @Binding var selection: Ride.ID?
  @State private var isImporting = false
  /// What went wrong opening the last files, while it is shown.
  @State private var failures: [String]?
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
      RideList(library: library, selection: $selection, isImporting: $isImporting)
        .navigationTitle("History")
        .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 420)
    } detail: {
      if let ride = library[selection] {
        ActivityDetailView(ride: ride) { remove(ride) }
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
    .alert("Couldn't open file", item: $failures) { _ in
    } message: { failures in
      Text(failures.joined(separator: "\n"))
    }
  }

  private func open(_ urls: [URL]) {
    let failures = library.open(urls)
    self.failures = failures.isEmpty ? nil : failures
  }

  private func remove(_ ride: Ride) {
    selection = nil
    library.remove(ride.id)
  }
}

#Preview {
  @Previewable @State var selection: Ride.ID?
  HistoryView(library: .sample(), selection: $selection)
    .environment(RiderSettingsStore.sample)
    .environment(StravaConnection.sample)
    .frame(width: 1100, height: 760)
}
