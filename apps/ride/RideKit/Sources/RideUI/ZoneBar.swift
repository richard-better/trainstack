import RideData
import SwiftUI

extension HeartRateZone {
  var color: Color {
    switch self {
    case .recovery: .gray
    case .aerobic: .blue
    case .tempo: .green
    case .threshold: .yellow
    case .vo2Max: .orange
    }
  }
}

/// A thin bar split by time in each heart rate zone.
struct ZoneBar: View {
  let shares: [ZoneShare]

  var body: some View {
    GeometryReader { proxy in
      HStack(spacing: 1) {
        ForEach(shares, id: \.zone) { share in
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
