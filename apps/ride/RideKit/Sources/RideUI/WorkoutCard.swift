import RideData
import SwiftUI

/// A workout to pick: its profile coloured by zone, so workouts can be told apart by shape and
/// intensity at a glance. Click to select, double-click to start.
struct WorkoutCard: View {
  let template: WorkoutTemplate
  var tag: String?
  var profileHeight: CGFloat = 96
  let isSelected: Bool
  let select: () -> Void
  let start: (() -> Void)?

  var body: some View {
    Button(action: select) { card }
      .buttonStyle(.plain)
      .simultaneousGesture(TapGesture(count: 2).onEnded { start?() })
      .accessibilityAddTraits(isSelected ? .isSelected : [])
      .accessibilityAction(named: "Start") { start?() }
  }

  private var card: some View {
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
          .fontWeight(.semibold)
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
}

extension WorkoutTemplate {
  /// `60 min · 52 TSS · Threshold`.
  var summary: String {
    "\(Int((duration / 60).rounded())) min · \(stressScore) TSS · \(category.name)"
  }
}

/// The steps of a workout as bars: width for duration, height and colour for intensity.
struct WorkoutProfile: View {
  let template: WorkoutTemplate
  /// The intensity that fills the full height. Harder steps are cut off.
  private static let ceiling = 1.75

  var body: some View {
    Canvas { context, size in
      let total = max(template.duration, 1)
      let gap: CGFloat = 1
      let width = size.width - gap * CGFloat(max(template.steps.count - 1, 0))
      var x: CGFloat = 0
      for step in template.steps {
        let stepWidth = max(width * step.duration / total, 0.5)
        let height = size.height * min(step.intensity / Self.ceiling, 1)
        let bar = CGRect(x: x, y: size.height - height, width: stepWidth, height: height)
        let shape = UnevenRoundedRectangle(topLeadingRadius: 2, topTrailingRadius: 2)
        context.fill(shape.path(in: bar), with: .color(step.zone.color))
        x += stepWidth + gap
      }
    }
    .accessibilityHidden(true)
  }
}

#Preview {
  WorkoutCard(
    template: .named("Threshold classic 60")!, isSelected: true, select: {}, start: nil
  )
  .frame(width: 260)
  .padding()
}
