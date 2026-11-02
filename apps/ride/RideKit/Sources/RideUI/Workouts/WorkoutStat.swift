import SwiftUI

struct WorkoutStat: View {
  let label: String
  let value: String
  var unit: String?

  var body: some View {
    VStack(spacing: 2) {
      HStack(alignment: .firstTextBaseline, spacing: 3) {
        Text(value).font(.title3.weight(.semibold))
        if let unit { Text(unit).font(.footnote).foregroundStyle(.secondary) }
      }
      .lineLimit(1)
      .minimumScaleFactor(0.7)
      Text(label).font(.caption).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .combine)
  }
}
