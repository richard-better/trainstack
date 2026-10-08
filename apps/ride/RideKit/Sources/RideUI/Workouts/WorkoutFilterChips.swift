import RideData
import SwiftUI

/// The library's filters as short capsules that fit an iPhone's width, and how many workouts
/// pass them.
struct WorkoutFilterChips: View {
  @Binding var state: WorkoutsState
  /// How many workouts pass the filters.
  let count: Int

  var body: some View {
    HStack(spacing: 8) {
      FilterMenu(
        title: "Duration", selection: $state.duration, any: .any, choiceTitle: \.title
      ) {
        ForEach(WorkoutDurationFilter.allCases, id: \.self) { Text($0.title).tag($0) }
      }
      FilterMenu(
        title: "Zone", selection: $state.zone, any: nil, choiceTitle: { $0?.name ?? "Any zone" }
      ) {
        Text("Any zone").tag(PowerZone?.none)
        ForEach(WorkoutFilterBar.zones, id: \.self) { Text($0.name).tag(Optional($0)) }
      }
      FilterMenu(title: "Stress", selection: $state.stress, any: .any, choiceTitle: \.title) {
        ForEach(WorkoutStressFilter.allCases, id: \.self) { Text($0.title).tag($0) }
      }
      Spacer(minLength: 0)
      Text("\(count)")
        .font(.footnote)
        .foregroundStyle(.secondary)
        .monospacedDigit()
        .accessibilityLabel("^[\(count) workout](inflect: true)")
    }
    .lineLimit(1)
  }
}
