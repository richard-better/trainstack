import SwiftUI

/// A headline number on Progress, with its label above.
struct HeadlineStat<Content: View>: View {
  let label: String
  var swatch: Color?
  @ViewBuilder let content: Content
  @ScaledMetric(relativeTo: .title) private var valueSize = 28.0

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 6) {
        if let swatch { Rectangle().fill(swatch).frame(width: 12, height: 2) }
        Text(label)
      }
      .font(.caption)
      .foregroundStyle(.secondary)
      HStack(alignment: .firstTextBaseline, spacing: 6) { content }
        .font(.system(size: valueSize, weight: .medium))
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
    .padding(.vertical, 14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}
