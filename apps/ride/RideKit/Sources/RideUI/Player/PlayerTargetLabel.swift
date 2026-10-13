import RideData
import SwiftUI

/// The target's label and zone, stacked when larger text leaves too little room for a row.
struct PlayerTargetLabel: View {
  let zone: PowerZone?

  var body: some View {
    let badge = zone.map { PowerZoneBadge(zone: $0) }
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
