import SwiftUI

struct SmallStat: View {
  let label: String
  let value: String
  var unit: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(label).font(.caption).foregroundStyle(.secondary)
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text(value).font(Design.statValueFont)
        if let unit { Text(unit).font(.subheadline).foregroundStyle(.secondary) }
      }
      .lineLimit(1)
      .minimumScaleFactor(0.6)
    }
    .padding(.vertical, 12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}
