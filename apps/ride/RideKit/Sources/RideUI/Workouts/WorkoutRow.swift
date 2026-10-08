import RideData
import SwiftUI

/// A workout as a list row: a small profile, its name, and a line about it.
struct WorkoutRow: View {
  let template: WorkoutTemplate
  let detail: String
  @ScaledMetric private var profileHeight = 36.0

  var body: some View {
    HStack(spacing: 12) {
      WorkoutProfile(template: template)
        .frame(width: profileHeight * 2.1, height: profileHeight)
        .overlay(alignment: .bottom) { Rectangle().fill(.separator).frame(height: 1) }
      VStack(alignment: .leading, spacing: 2) {
        Text(template.name).font(.body.weight(.semibold))
        Text(detail)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .monospacedDigit()
      }
    }
    .padding(.vertical, 1)
    .accessibilityElement(children: .combine)
  }
}
