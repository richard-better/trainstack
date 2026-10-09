import RideData
import SwiftUI

/// The library's Duration, Zone and Stress filters as capsules. Shared by the iPhone chips and
/// the filter bar of wider windows.
struct WorkoutFilterMenus: View {
  @Binding var state: WorkoutsState

  var body: some View {
    FilterMenu(
      title: "Duration", selection: $state.duration, any: .any, choiceTitle: \.title
    ) {
      ForEach(WorkoutDurationFilter.allCases, id: \.self) { Text($0.title).tag($0) }
    }
    FilterMenu(
      title: "Zone", selection: $state.zone, any: nil, choiceTitle: Self.zoneTitle
    ) {
      Text("Any zone").tag(PowerZone?.none)
      ForEach(WorkoutFilterBar.zones, id: \.self) { Text($0.name).tag(Optional($0)) }
    }
    FilterMenu(title: "Stress", selection: $state.stress, any: .any, choiceTitle: \.title) {
      ForEach(WorkoutStressFilter.allCases, id: \.self) { Text($0.title).tag($0) }
    }
  }

  private static func zoneTitle(_ zone: PowerZone?) -> String { zone?.name ?? "Any zone" }
}
