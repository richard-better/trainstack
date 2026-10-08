import RideData
import SwiftUI

/// A zone's name after a dot in its colour, heading the workouts that train it.
struct ZoneLabel: View {
  let zone: PowerZone

  var body: some View {
    HStack(spacing: 6) {
      Circle().fill(zone.color).frame(width: 8, height: 8)
      Text(zone.name)
    }
  }
}
