import SwiftUI

/// A headline number with its label above and unit beside it.
struct RideStatCell: View {
  let stat: RideStat

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(stat.label).font(.caption).foregroundStyle(.secondary)
      HStack(alignment: .firstTextBaseline, spacing: 3) {
        Text(stat.value).font(Design.statValueFont)
        if let unit = stat.unit { Text(unit).font(.footnote).foregroundStyle(.secondary) }
      }
    }
    .lineLimit(1)
    .monospacedDigit()
    .padding(.vertical, 12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}
