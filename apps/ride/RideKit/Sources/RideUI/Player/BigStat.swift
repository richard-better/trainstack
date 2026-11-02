import SwiftUI

struct BigStat<Label: View>: View {
  let value: String
  let unit: String
  var detail = ""
  @ViewBuilder let label: Label
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
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
