import SwiftUI

/// One of a ride's sensors as its symbol, with a badge for how it is doing: a green dot while it
/// reports, a grey one while it connects, a yellow warning once it has gone quiet, and a red
/// cross when it is not connected.
struct SensorStatusIcon: View {
  let status: SensorStatus

  var body: some View {
    Image(systemName: symbol)
      .foregroundStyle(status.health == .live ? Color.primary : .secondary)
      .symbolEffect(.pulse, isActive: status.health == .connecting)
      .overlay(alignment: .topTrailing) { badge.offset(x: 5, y: -4) }
      .help(summary)
      .accessibilityElement()
      .accessibilityLabel(summary)
  }

  @ViewBuilder private var badge: some View {
    switch status.health {
    case .live: Circle().fill(.green).frame(width: 7, height: 7)
    case .connecting: Circle().fill(.secondary).frame(width: 7, height: 7)
    case .quiet: badgeSymbol("exclamationmark.circle.fill", color: .yellow)
    case .disconnected: badgeSymbol("xmark.circle.fill", color: .red)
    }
  }

  private func badgeSymbol(_ name: String, color: Color) -> some View {
    Image(systemName: name)
      .font(.system(size: 9, weight: .bold))
      .symbolRenderingMode(.palette)
      .foregroundStyle(.black, color)
  }

  private var symbol: String {
    switch status.source {
    case .trainer: "bicycle"
    case .powerMeter: "bolt"
    case .cadenceSensor: "gauge.with.needle"
    case .heartRateStrap: "heart"
    case .watch: "applewatch"
    }
  }

  /// What the icon tells, for the tooltip and VoiceOver.
  var summary: String {
    let health =
      switch status.health {
      case .live: "connected"
      case .quiet: "no data"
      case .connecting: "connecting"
      case .disconnected: "disconnected"
      }
    let battery = status.batteryLevel.map { ", \($0)% battery" } ?? ""
    return "\(status.name): \(health)\(battery)"
  }
}
