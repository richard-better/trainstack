import RideData
import SwiftUI

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
