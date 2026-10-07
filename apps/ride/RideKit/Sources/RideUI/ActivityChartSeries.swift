import SwiftUI

/// A series of the ride's chart, which its legend switches on and off.
enum ActivityChartSeries: String, CaseIterable {
  case target = "Target"
  case power = "Power"
  case heartRate = "Heart rate"

  var color: Color {
    switch self {
    case .target: Color.primary.opacity(0.14)
    case .power: Color.primary.opacity(0.85)
    case .heartRate: .red
    }
  }

  /// Height of the legend swatch: a filled block for the target, a line for the others.
  var swatchHeight: Double { self == .target ? 10 : 2 }
}
