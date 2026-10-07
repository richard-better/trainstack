import RideData
import SwiftUI

/// A thin bar split by time in each zone.
struct ZoneBar: View {
  let shares: [ZoneShare]

  var body: some View {
    GeometryReader { proxy in
      HStack(spacing: 1) {
        ForEach(shares) { share in
          Rectangle()
            .fill(share.zone.color)
            .frame(width: max(0, proxy.size.width * share.fraction))
        }
      }
    }
    .background(.quaternary.opacity(0.5))
    .clipShape(.rect(cornerRadius: 2))
    .accessibilityHidden(true)
  }
}
