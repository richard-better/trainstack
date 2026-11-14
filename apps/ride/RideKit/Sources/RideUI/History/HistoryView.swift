import RideData
import SwiftUI

struct HistoryView: View {
  let library: RideLibrary
  @Binding var selection: HistoryEntry.ID?
  @Environment(AccountHistory.self) private var history
  @Environment(\.deleteActivity) private var deleteActivity
  @State private var workoutPath: [WorkoutTemplate] = []
  @State private var isImporting = false
  @State private var failures: [String]?
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif

  private var showsBothColumns: Bool {
    #if os(iOS)
      sizeClass == .regular
    #else
      true
    #endif
  }

  private var entries: [HistoryEntry] {
    HistoryEntry.merging(rides: library.rides, account: history.activities)
  }

  private func selectNewestRideWhenBothColumnsShow() {
    if showsBothColumns, selection == nil { selection = entries.first?.id }
  }

  var body: some View {
    NavigationSplitView {
      RideList(
        entries: entries, library: library, selection: $selection, isImporting: $isImporting
      )
      .navigationTitle("History")
      .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 420)
    } detail: {
      if let entry = entries.first(where: { $0.id == selection }) {
        NavigationStack(path: $workoutPath) {
          detail(of: entry)
            .id(entry.id)
            .navigationTitle(entry.activity?.title ?? entry.ride?.title ?? "")
            #if os(iOS)
              .navigationBarTitleDisplayMode(.inline)
            #endif
            .navigationDestination(for: WorkoutTemplate.self, destination: WorkoutDetailView.init)
        }
        .environment(\.openWorkout, OpenWorkoutAction { workoutPath.append($0) })
      } else {
        ContentUnavailableView("Select an activity", systemImage: "chart.xyaxis.line")
      }
    }
    .onChange(of: selection) { workoutPath = [] }
    .onChange(of: entries.first?.id, initial: true) { selectNewestRideWhenBothColumnsShow() }
    .onChange(of: showsBothColumns) { selectNewestRideWhenBothColumnsShow() }
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

  @ViewBuilder private func detail(of entry: HistoryEntry) -> some View {
    if let ride = entry.ride {
      ActivityDetailView(ride: ride, library: library, activity: entry.activity) {
        remove(entry)
      }
    } else if let activity = entry.activity {
      AccountActivityDetailView(activity: activity, library: library) { remove(entry) }
    }
  }

  private func remove(_ entry: HistoryEntry) {
    selection = nil
    if entry.ride != nil {
      library.remove(entry.id)
    } else {
      deleteActivity(entry.id)
    }
  }
}

#Preview {
  @Previewable @State var selection: HistoryEntry.ID?
  HistoryView(library: .sample(), selection: $selection)
    .environment(AccountHistory.preview)
    .environment(RiderSettingsStore.sample)
    .environment(TrainstackAccount.sample)
    .environment(RideLauncher(simulated: true))
    .frame(width: 1100, height: 760)
}
