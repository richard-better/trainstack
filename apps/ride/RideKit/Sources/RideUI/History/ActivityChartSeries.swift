import SwiftUI

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

  var swatchHeight: Double { self == .target ? 10 : 2 }
}
