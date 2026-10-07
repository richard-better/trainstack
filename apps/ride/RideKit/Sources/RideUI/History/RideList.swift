import RideData
import SwiftUI

/// Finished rides by month, newest first, with a way to open more.
struct RideList: View {
  let library: RideLibrary
  @Binding var selection: Ride.ID?
  @Binding var isImporting: Bool
  @Environment(\.calendar) private var calendar

  var body: some View {
    List(selection: $selection) {
      ForEach(RideMonth.grouping(library.rides, calendar: calendar)) { month in
        Section(month.label) {
          ForEach(month.rides) { RideRow(ride: $0).tag($0.id) }
        }
      }
    }
    .overlay {
      if library.rides.isEmpty {
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
