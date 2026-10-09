import SwiftUI

/// One of the player's four main numbers, with its label above and a detail line below.
struct BigStat<Label: View>: View {
  let value: String
  let unit: String
  /// A line under the number. Every stat keeps room for one so the numbers line up.
  var detail = ""
  @ViewBuilder let label: Label
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// Big enough to read from the saddle, and bigger still with larger text.
  @ScaledMetric(relativeTo: .largeTitle) private var valueSize = 84.0

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      label.font(.subheadline).foregroundStyle(.secondary).frame(minHeight: 20)
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text(value)
          .font(.system(size: valueSize, weight: .medium))
          .tracking(-1.5)
          .contentTransition(.numericText())
          .animation(reduceMotion ? nil : .default, value: value)
        Text(unit).font(.title3).foregroundStyle(.secondary)
      }
      .lineLimit(1)
      .minimumScaleFactor(0.4)
      Text(detail.isEmpty ? " " : detail).font(.caption).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}
