import RideData
import SwiftUI

struct PlayerTargetLabel: View {
  let interval: RideSession.Interval?
  let ftp: Int

  var body: some View {
    let badge = interval.map { IntervalBadge(interval: $0, ftp: ftp) }
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
