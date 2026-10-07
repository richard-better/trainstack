import RideData
import SwiftUI

/// The four numbers a rider checks most: target, power, cadence and heart rate. One row on a
/// wide window, otherwise two.
struct PlayerPrimaryStats: View {
  let controller: RideController

  var body: some View {
    let session = controller.session
    let target = BigStat(value: targetValue.value, unit: targetValue.unit) {
      HStack(spacing: 8) {
        Text("Target")
        if let interval = session.currentInterval {
          let zone = controller.zone(of: interval)
          Text("Z\(zone.rawValue + 1) \(zone.name)")
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 1)
            .background(.quaternary, in: .capsule)
        }
      }
    }
    let power = BigStat(
      value: session.latest.power.map(String.init) ?? "—", unit: "W", detail: powerDetail
    ) {
      LegendSwatch(title: "Power", color: .primary.opacity(0.85), height: 2)
    }
    let cadence = BigStat(value: session.latest.cadence.map(String.init) ?? "—", unit: "rpm") {
      Text("Cadence")
    }
    let heartRate = BigStat(value: session.latest.heartRate.map(String.init) ?? "—", unit: "bpm") {
      LegendSwatch(title: "Heart rate", color: .red, height: 2)
    }
    ViewThatFits(in: .horizontal) {
      DividedRow {
        target
        power
        cadence
        heartRate
      }
      .frame(minWidth: 760)
      Grid(horizontalSpacing: 0, verticalSpacing: 16) {
        GridRow {
          target
          power
        }
        GridRow {
          cadence
          heartRate
        }
      }
    }
  }

  /// What the trainer is aiming for in the current mode.
  private var targetValue: (value: String, unit: String) {
    let session = controller.session
    return switch session.mode {
    case .erg: (session.targetPower.map(String.init) ?? "—", "W")
    case .slope: (session.grade.formatted(.oneDecimal), "%")
    case .level: ("\(session.level)", "level")
    }
  }

  /// How power compares with the target in ERG mode, where the trainer holds it.
  private var powerDetail: String {
    let session = controller.session
    guard session.mode == .erg else { return "Free power in \(session.mode.rawValue)" }
    guard !session.isPaused, let target = session.targetPower, let power = session.latest.power
    else { return "" }
    let difference = power - target
    if abs(Double(difference)) <= Double(target) * 0.05 { return "On target" }
    return "\(difference > 0 ? "+" : "−")\(abs(difference)) W vs target"
  }
}
