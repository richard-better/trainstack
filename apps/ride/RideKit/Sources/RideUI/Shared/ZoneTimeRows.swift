import RideData
import RideStyle
import SwiftUI

/// Time in each zone, as a bar, a percentage and a duration per zone.
struct ZoneTimeRows: View {
  let shares: [ZoneShare]

  var body: some View {
    Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 9) {
      ForEach(shares) { share in
        GridRow {
          Text(share.zone.name).foregroundStyle(.secondary)
          ProgressBar(fraction: share.fraction, color: share.zone.color)
          Text("\(Int((share.fraction * 100).rounded()))%")
            .gridColumnAlignment(.trailing)
          Text(share.seconds > 0 ? share.seconds.spokenString : "—")
            .foregroundStyle(.secondary)
            .gridColumnAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
      }
    }
    .monospacedDigit()
  }
}
