import RideData
import SwiftUI

extension Zone {
  public var color: Color { Self.color(index: index, zoneCount: zoneCount) }

  public static func color(index: Int, zoneCount: Int) -> Color {
    let palette = zoneCount == 3 ? threeZonePalette : easiestToHardestPalette
    return palette[min(max(index, 0), palette.count - 1)]
  }

  static let threeZonePalette: [Color] = [.blue, .yellow, .red]

  static let easiestToHardestPalette: [Color] = [
    .gray, .blue, .green, .yellow, .orange, .red, Color(red: 0.84, green: 0, blue: 0.08),
  ]
}

extension PowerZone {
  public var color: Color {
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
