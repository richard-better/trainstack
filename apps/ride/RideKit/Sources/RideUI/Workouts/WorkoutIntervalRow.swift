import SwiftUI

/// One line of a workout's intervals: its colour, how many times it repeats, what it is, and
/// its target and length.
struct WorkoutIntervalRow: View {
  let color: Color
  /// `3×` on the first step of a set, otherwise empty.
  let repeats: String
  let name: String
  let detail: String
  /// The target in watts, when there is an FTP to set it from.
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
