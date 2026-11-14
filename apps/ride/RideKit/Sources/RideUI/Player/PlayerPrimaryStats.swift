import RideData
import SwiftUI

struct PlayerPrimaryStats: View {
  let controller: RideController
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let session = controller.session
    let target = BigStat(
      value: targetValue.value, unit: targetValue.unit,
      detail: targetDetail
    ) {
      PlayerTargetLabel(interval: session.currentInterval, ftp: controller.ftp)
    }
    let power = BigStat(
      value: controller.power.map(String.init) ?? "—", unit: "W", detail: powerDetail
    ) {
      LegendSwatch(title: "Power", color: .primary.opacity(0.85), height: 2)
    }
    let cadence = BigStat(
      value: session.latest.cadence.map(String.init) ?? "—", unit: "rpm",
      detail: session.currentInterval?.step.cadence.map { "Target \(StepTargetText.cadence($0))" }
        ?? ""
    ) {
      Text("Cadence")
    }
    let heartRate = BigStat(
      value: session.latest.heartRate.map(String.init) ?? "—", unit: "bpm",
      detail: session.latest.heartRate == nil ? "" : session.latest.heartRateSource?.name ?? ""
    ) {
      PlayerHeartRateLabel(zone: controller.heartRateZone)
    }
    if dynamicTypeSize.isAccessibilitySize {
      VStack(alignment: .leading, spacing: 16) {
        target
        power
        cadence
        heartRate
      }
    } else {
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
  }

  private var targetValue: (value: String, unit: String) {
    let session = controller.session
    return switch session.mode {
    case .erg: ergTargetValue
    case .slope: (session.slopeGradePercent.formatted(.oneDecimal), "%")
    case .level: ("\(session.level)", "level")
    }
  }

  private var ergTargetValue: (value: String, unit: String) {
    let session = controller.session
    if let target = session.targetPower { return (String(target), "W") }
    return switch session.currentInterval?.step.target {
    case .heartRate(let heartRate): StepTargetText.heartRate(heartRate)
    case .maxEffort: ("All out", "")
    case nil where session.currentInterval != nil: ("Free", "")
    case .power, nil: ("—", "W")
    }
  }

  private var targetDetail: String {
    let session = controller.session
    let average = controller.totals.intervalAveragePower.map { "Interval avg \($0) W" }
    guard session.mode == .erg, case .power(let level) = session.currentInterval?.step.target
    else { return average ?? "" }
    let adjusted = level.mapped { Double(session.adjusted(Int($0))) }
    let planned: String? =
      switch level {
      case .constant: nil
      case .range: "Range \(StepTargetText.value(adjusted)) W"
      case .ramp: "Ramp \(StepTargetText.value(adjusted)) W"
      }
    return [planned, average].compactMap(\.self).joined(separator: " · ")
  }

  private var powerDetail: String {
    let session = controller.session
    guard session.mode == .erg else { return "Free power in \(session.mode.rawValue)" }
    guard !session.isPaused, let target = session.targetPower, let power = controller.power
    else { return "" }
    let difference = power - target
    if abs(Double(difference)) <= Double(target) * 0.05 { return "On target" }
    return "\(difference > 0 ? "+" : "−")\(abs(difference)) W vs target"
  }
}
