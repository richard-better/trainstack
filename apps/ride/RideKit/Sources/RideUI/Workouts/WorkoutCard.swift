import RideData
import RideStyle
import SwiftUI

/// A workout to pick: its profile coloured by zone, so workouts can be told apart by shape and
/// intensity at a glance. Click to select, double-click to start. The selected card has its
/// zone's colour around it and a Start button.
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
          .background(.primary.opacity(0.05))
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
      .background(.primary.opacity(isSelected ? 0.07 : 0.04))
      .clipShape(.rect(cornerRadius: 14))
      .overlay {
        RoundedRectangle(cornerRadius: 14)
          .strokeBorder(
            isSelected
              ? AnyShapeStyle(template.category.color) : AnyShapeStyle(.primary.opacity(0.06)),
            lineWidth: isSelected ? 2 : 1)
      }
      .contentShape(.rect(cornerRadius: 14))
    }
    .buttonStyle(.plain)
    .overlay(alignment: .topTrailing) {
      if isSelected, let start {
        Button("Start", systemImage: "play.fill", action: start)
          .buttonStyle(.glass)
          .buttonBorderShape(.capsule)
          .controlSize(.small)
          .padding(10)
      }
    }
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
