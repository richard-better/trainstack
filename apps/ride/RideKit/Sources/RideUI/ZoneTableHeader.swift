import RideData
import SwiftUI

struct ZoneTableHeader: View {
  let reference: Threshold
  let hasPercentColumn: Bool
  @ScaledMetric private var limitWidth = ZoneColumn.limit
  @ScaledMetric private var percentWidth = ZoneColumn.percent

  var body: some View {
    HStack(spacing: 10) {
      VStack(alignment: .leading, spacing: 2) {
        Text("Zone")
        if !hasPercentColumn { Text(percentTitle) }
      }
      .padding(.leading, 18)
      Spacer()
      Text("From").frame(width: limitWidth, alignment: .trailing)
      Text("–").hidden()
      Text("To").frame(width: limitWidth, alignment: .leading)
      if hasPercentColumn {
        Text(percentTitle)
          .frame(width: percentWidth, alignment: .trailing)
      }
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }

  private var percentTitle: String { "% of \(reference.abbreviation)" }
}
