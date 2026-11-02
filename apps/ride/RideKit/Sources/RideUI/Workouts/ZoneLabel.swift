import RideData
import RideStyle
import SwiftUI

struct ZoneLabel: View {
  let zone: PowerZone

  var body: some View {
    HStack(spacing: 6) {
      Circle().fill(zone.color).frame(width: 8, height: 8)
      Text(zone.name)
    }
  }
}
