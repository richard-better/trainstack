import RideData
import SwiftUI

struct WorkoutFilterMenus: View {
  @Binding var state: WorkoutsState

  var body: some View {
    FilterMenu(
      title: "Duration", selection: $state.duration, unfiltered: .any, choiceTitle: \.title
    ) {
      ForEach(WorkoutDurationFilter.allCases, id: \.self) { Text($0.title).tag($0) }
    }
    FilterMenu(
      title: "Zone", selection: $state.zone, unfiltered: nil, choiceTitle: Self.zoneTitle
    ) {
      Text("Any zone").tag(PowerZone?.none)
      ForEach(WorkoutFilterBar.zones, id: \.self) { Text($0.name).tag(Optional($0)) }
    }
    FilterMenu(title: "Stress", selection: $state.stress, unfiltered: .any, choiceTitle: \.title) {
      ForEach(WorkoutStressFilter.allCases, id: \.self) { Text($0.title).tag($0) }
    }
  }

  private static func zoneTitle(_ zone: PowerZone?) -> String { zone?.name ?? "Any zone" }
}
