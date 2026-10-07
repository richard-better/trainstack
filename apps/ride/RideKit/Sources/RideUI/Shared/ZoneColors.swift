import RideData
import SwiftUI

extension Zone {
  /// Zone colours run from grey for recovery to red for the hardest. Three-zone models use
  /// blue, yellow and red.
  nonisolated var color: Color {
    let palette: [Color] =
      zoneCount == 3
      ? [.blue, .yellow, .red]
      : [.gray, .blue, .green, .yellow, .orange, .red, Color(red: 0.84, green: 0, blue: 0.08)]
    return palette[min(index, palette.count - 1)]
  }
}

extension PowerZone {
  nonisolated var color: Color {
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
