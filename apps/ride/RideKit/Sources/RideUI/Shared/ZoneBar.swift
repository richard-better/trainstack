import RideData
import RideStyle
import SwiftUI

struct ZoneBar: View {
  let fractions: [Double]

  init(shares: [ZoneShare]) {
    var fractions = Array(repeating: 0.0, count: shares.map(\.zone.zoneCount).max() ?? 0)
    for share in shares where fractions.indices.contains(share.zone.index) {
      fractions[share.zone.index] = share.fraction
    }
    self.fractions = fractions
  }

  init(fractions: [Double]) {
    self.fractions = fractions
  }

  var body: some View {
    ProportionalRow(spacing: 1) {
      ForEach(Array(fractions.enumerated()), id: \.offset) { index, fraction in
        if fraction > 0 {
          Rectangle()
            .fill(Zone.color(index: index, zoneCount: fractions.count))
            .layoutProportion(fraction)
        }
      }
    }
    .background(.quaternary.opacity(0.5))
    .clipShape(.rect(cornerRadius: 2))
    .accessibilityHidden(true)
  }
}
