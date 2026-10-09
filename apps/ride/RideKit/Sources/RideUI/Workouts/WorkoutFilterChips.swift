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
      WorkoutFilterMenus(state: $state)
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
