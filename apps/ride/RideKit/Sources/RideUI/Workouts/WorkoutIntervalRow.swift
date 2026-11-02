import SwiftUI

struct WorkoutIntervalRow: View {
  let color: Color
  let repeats: String
  let name: String
  let detail: String
  let watts: String?
  let duration: String
  @ScaledMetric private var repeatsWidth = 24.0

  var body: some View {
    HStack(spacing: 10) {
      Capsule().fill(color).frame(width: 4, height: 30)
      Text(repeats)
        .font(.footnote.weight(.semibold))
        .foregroundStyle(.secondary)
        .frame(width: repeatsWidth, alignment: .leading)
      VStack(alignment: .leading, spacing: 1) {
        Text(name).font(.subheadline.weight(.semibold))
        Text(detail).font(.caption).foregroundStyle(.secondary)
      }
      Spacer(minLength: 8)
      VStack(alignment: .trailing, spacing: 1) {
        if let watts { Text(watts).font(.subheadline.weight(.semibold)) }
        Text(duration).font(.caption).foregroundStyle(.secondary)
      }
    }
    .monospacedDigit()
    .padding(.vertical, 9)
    .accessibilityElement(children: .combine)
  }
}
