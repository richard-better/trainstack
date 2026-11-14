import RideData
import RideStyle
import SwiftUI

struct WorkoutCard<Profile: View>: View {
  let name: String
  let summary: String
  let color: Color
  var warning: String?
  var tag: String?
  var profileHeight = 96.0
  let isSelected: Bool
  let select: () -> Void
  let open: () -> Void
  let start: (() -> Void)?
  @ViewBuilder let profile: Profile

  var body: some View {
    Button(action: select) {
      VStack(alignment: .leading, spacing: 0) {
        profile
          .padding(.horizontal, 12)
          .padding(.top, 14)
          .frame(height: profileHeight)
          .background(.primary.opacity(0.05))
        VStack(alignment: .leading, spacing: 4) {
          if let tag {
            Text(tag).font(.caption).foregroundStyle(.secondary)
          }
          Text(name)
            .font(.headline)
            .lineLimit(1)
          HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(summary)
          }
          .font(.caption.monospacedDigit())
          .foregroundStyle(.secondary)
          if let warning {
            Label(warning, systemImage: "exclamationmark.circle")
              .font(.caption)
              .foregroundStyle(.orange)
              .lineLimit(2)
          }
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
              ? AnyShapeStyle(color) : AnyShapeStyle(.primary.opacity(0.06)),
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
    .simultaneousGesture(TapGesture(count: 2).onEnded { open() })
    .accessibilityAddTraits(isSelected ? .isSelected : [])
    .accessibilityAction(named: "Show details", open)
    .accessibilityAction(named: "Start") { start?() }
  }
}

extension WorkoutCard where Profile == WorkoutProfile {
  init(
    template: WorkoutTemplate, tag: String? = nil, profileHeight: Double = 96,
    isSelected: Bool, select: @escaping () -> Void, open: @escaping () -> Void,
    start: (() -> Void)?
  ) {
    self.init(
      name: template.name, summary: template.summary, color: template.category.color, tag: tag,
      profileHeight: profileHeight, isSelected: isSelected, select: select, open: open,
      start: start
    ) {
      WorkoutProfile(template: template)
    }
  }
}

#Preview {
  WorkoutCard(
    template: .named("Threshold classic 60")!, isSelected: true, select: {}, open: {}, start: nil
  )
  .frame(width: 260)
  .padding()
}
