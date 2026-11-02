import RideData
import SwiftUI

struct WorkoutFilterChips: View {
  @Binding var state: WorkoutsState
  let matchingCount: Int

  var body: some View {
    HStack(spacing: 8) {
      WorkoutFilterMenus(state: $state)
      Spacer(minLength: 0)
      Text("\(matchingCount)")
        .font(.footnote)
        .foregroundStyle(.secondary)
        .monospacedDigit()
        .accessibilityLabel("^[\(matchingCount) workout](inflect: true)")
    }
    .lineLimit(1)
  }
}
