import RideData
import SwiftUI

extension Zone {
  /// Zone colours run from grey for recovery to red for the hardest. Three-zone models use
  /// blue, yellow and red.
  func color(in zones: ZoneSet) -> Color {
    let palette: [Color] =
      zones.zones.count == 3
      ? [.blue, .yellow, .red]
      : [.gray, .blue, .green, .yellow, .orange, .red, Color(red: 0.84, green: 0, blue: 0.08)]
    return palette[min(index, palette.count - 1)]
  }
}

/// A thin bar split by time in each zone.
struct ZoneBar: View {
  let zones: ZoneSet
  let shares: [ZoneShare]

  var body: some View {
    GeometryReader { proxy in
      HStack(spacing: 1) {
        ForEach(shares, id: \.zone) { share in
          Rectangle()
            .fill(share.zone.color(in: zones))
            .frame(width: max(0, proxy.size.width * share.fraction))
        }
      }
    }
    .background(.quaternary.opacity(0.5))
    .clipShape(.rect(cornerRadius: 2))
    .accessibilityHidden(true)
  }
}
