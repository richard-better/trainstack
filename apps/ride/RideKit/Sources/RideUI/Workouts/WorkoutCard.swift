import RideData
import RideStyle
import SwiftUI

/// A workout to pick: its profile coloured by zone, so workouts can be told apart by shape and
/// intensity at a glance. Click to select, double-click to start.
struct WorkoutCard: View {
  let template: WorkoutTemplate
  var tag: String?
  var profileHeight = 96.0
  let isSelected: Bool
  let select: () -> Void
  let start: (() -> Void)?

  var body: some View {
    Button(action: select) {
      VStack(alignment: .leading, spacing: 0) {
        WorkoutProfile(template: template)
          .padding(.horizontal, 12)
          .padding(.top, 14)
          .frame(height: profileHeight)
          .background(.black.opacity(0.12))
        VStack(alignment: .leading, spacing: 4) {
          if let tag {
            Text(tag).font(.caption).foregroundStyle(.secondary)
          }
          Text(template.name)
            .font(.headline)
            .lineLimit(1)
          HStack(spacing: 6) {
            Circle().fill(template.category.color).frame(width: 7, height: 7)
            Text(template.summary)
          }
          .font(.caption.monospacedDigit())
          .foregroundStyle(.secondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .background(.primary.opacity(isSelected ? 0.09 : 0.04))
      .clipShape(.rect(cornerRadius: 10))
      .overlay {
        RoundedRectangle(cornerRadius: 10)
          .strokeBorder(.primary.opacity(isSelected ? 0.4 : 0.06))
      }
      .contentShape(.rect(cornerRadius: 10))
    }
    .buttonStyle(.plain)
    .simultaneousGesture(TapGesture(count: 2).onEnded { start?() })
    .accessibilityAddTraits(isSelected ? .isSelected : [])
    .accessibilityAction(named: "Start") { start?() }
  }
}

#Preview {
  WorkoutCard(
    template: .named("Threshold classic 60")!, isSelected: true, select: {}, start: nil
  )
  .frame(width: 260)
  .padding()
}
