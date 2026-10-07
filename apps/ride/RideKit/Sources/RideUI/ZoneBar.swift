import RideData
import SwiftUI

/// A zone with a name and a colour to draw it in.
nonisolated protocol RideZone: Hashable, Sendable {
  var name: String { get }
  var color: Color { get }
}

nonisolated extension HeartRateZone: RideZone {
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

nonisolated extension PowerZone: RideZone {
  var color: Color {
    switch self {
    case .recovery: .gray
    case .endurance: .blue
    case .tempo: .green
    case .threshold: .yellow
    case .vo2Max: .orange
    case .anaerobic: .red
    }
  }
}

/// A thin bar split by time in each zone.
struct ZoneBar<Zone: RideZone>: View {
  let shares: [ZoneShare<Zone>]

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
