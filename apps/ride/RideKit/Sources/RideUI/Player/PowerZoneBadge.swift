import RideData
import RideStyle
import SwiftUI

/// A power zone's number and name in a capsule, such as "Z4 Threshold". Highlighted, the capsule
/// takes the zone's colour.
struct PowerZoneBadge: View {
  let zone: PowerZone
  var isHighlighted = false

  var body: some View {
    Text("Z\(zone.rawValue + 1) \(zone.name)")
      .font(.caption)
      .padding(.horizontal, 8)
      .padding(.vertical, 1)
      .background(
        isHighlighted ? AnyShapeStyle(zone.color.opacity(0.35)) : AnyShapeStyle(.quaternary),
        in: .capsule)
  }
}
