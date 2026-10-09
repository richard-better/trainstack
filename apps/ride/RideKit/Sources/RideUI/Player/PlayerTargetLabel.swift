import RideData
import SwiftUI

/// The target's label and zone, stacked when larger text leaves too little room for a row.
struct PlayerTargetLabel: View {
  let zone: PowerZone?

  var body: some View {
    let badge = zone.map { zone in
      Text("Z\(zone.rawValue + 1) \(zone.name)")
        .font(.caption)
        .padding(.horizontal, 8)
        .padding(.vertical, 1)
        .background(.quaternary, in: .capsule)
    }
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 8) {
        Text("Target")
        badge
      }
      VStack(alignment: .leading, spacing: 4) {
        Text("Target")
        badge
      }
    }
  }
}
