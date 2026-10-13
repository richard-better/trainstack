import RideData
import RideStyle
import SwiftUI

/// The heart rate's label and zone in its colour, stacked when larger text leaves too little room
/// for a row.
struct PlayerHeartRateLabel: View {
  let zone: Zone?

  var body: some View {
    let title = LegendSwatch(title: "Heart rate", color: .red, height: 2)
    let badge = zone.map { zone in
      Text("Z\(zone.label) \(zone.name)")
        .font(.caption)
        .padding(.horizontal, 8)
        .padding(.vertical, 1)
        .background(zone.color.opacity(0.3), in: .capsule)
    }
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 8) {
        title
        badge
      }
      VStack(alignment: .leading, spacing: 4) {
        title
        badge
      }
    }
  }
}
