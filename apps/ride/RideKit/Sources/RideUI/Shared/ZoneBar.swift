import RideData
import RideStyle
import SwiftUI

/// A thin bar split by time in each zone.
struct ZoneBar: View {
  let shares: [ZoneShare]

  var body: some View {
    ProportionalRow(spacing: 1) {
      ForEach(shares.filter { $0.fraction > 0 }) { share in
        Rectangle()
          .fill(share.zone.color)
          .layoutProportion(share.fraction)
      }
    }
    .background(.quaternary.opacity(0.5))
    .clipShape(.rect(cornerRadius: 2))
    .accessibilityHidden(true)
  }
}
