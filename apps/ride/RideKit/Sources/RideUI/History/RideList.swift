import RideData
import SwiftUI

struct RideList: View {
  let entries: [HistoryEntry]
  let library: RideLibrary
  @Binding var selection: HistoryEntry.ID?
  @Binding var isImporting: Bool
  @Environment(\.calendar) private var calendar

  var body: some View {
    List(selection: $selection) {
      ForEach(RideMonth.grouping(entries, calendar: calendar)) { month in
        Section(month.label) {
          ForEach(month.entries) { HistoryRow(entry: $0, library: library).tag($0.id) }
        }
      }
    }
    .overlay {
      if entries.isEmpty {
        ContentUnavailableView {
          Label("No rides yet", systemImage: "clock")
        } description: {
          Text("Open a FIT file, or drop one here, to see how a ride went.")
        } actions: {
          Button("Open FIT File…", action: showImporter)
        }
      }
    }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button("Open FIT File", systemImage: "plus", action: showImporter)
      }
    }
  }

  private func showImporter() { isImporting = true }
}
