import RideData
import SwiftUI

extension Intensity {
  var color: Color {
    switch self {
    case .easy: .blue
    case .moderate: .yellow
    case .hard: .red
    }
  }

  func color(differentiatingWithoutColor: Bool) -> Color {
    guard differentiatingWithoutColor else { return color }
    return switch self {
    case .easy: color.opacity(0.35)
    case .moderate: color.opacity(0.65)
    case .hard: color
    }
  }
}
