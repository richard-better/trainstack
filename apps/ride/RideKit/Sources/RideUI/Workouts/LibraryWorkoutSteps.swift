import RideData
import RideStyle
import SwiftUI

struct LibraryWorkoutSteps: View {
  let workout: TrainStackWorkout
  let ftp: Int?

  var body: some View {
    ForEach(rows.enumerated(), id: \.offset) { _, row in
      WorkoutIntervalRow(
        color: row.color, repeats: row.repeats, name: row.name, detail: row.detail,
        watts: row.watts, duration: row.duration
      )
      .padding(.leading, Double(row.depth) * 16)
    }
  }

  private struct Row {
    var depth: Int
    var color: Color
    var repeats = ""
    var name: String
    var detail: String
    var watts: String?
    var duration: String
  }

  private var rows: [Row] { Self.rows(of: workout.blocks, depth: 0, ftp: ftp) }

  private static func rows(of blocks: [TrainStackWorkout.Block], depth: Int, ftp: Int?) -> [Row] {
    blocks.flatMap { block -> [Row] in
      switch block {
      case .step(let step): [row(of: step, depth: depth, ftp: ftp)]
      case .repeat(let block):
        [
          Row(
            depth: depth, color: .clear, repeats: "\(block.count)×", name: block.name ?? "Repeat",
            detail: block.cues.map(\.text).joined(separator: " · "), duration: "")
        ] + rows(of: block.blocks, depth: depth + 1, ftp: ftp)
      case .unknown(let type):
        [Row(depth: depth, color: .clear, name: "Unknown", detail: type, duration: "")]
      }
    }
  }

  private static func row(of step: TrainStackWorkout.Step, depth: Int, ftp: Int?) -> Row {
    let target = describe(step.target, ftp: ftp)
    let extras =
      [
        step.cadence.map { "\(level($0, scale: 1)) rpm" }, step.notes,
      ] + step.cues.map { "“\($0.text)”" }
    return Row(
      depth: depth, color: target.zone?.color ?? .secondary.opacity(0.4),
      name: step.name ?? target.name,
      detail: ([target.detail] + extras).compactMap(\.self).joined(separator: " · "),
      watts: target.watts, duration: duration(step.duration))
  }

  private static func describe(_ target: TrainStackWorkout.Target?, ftp: Int?) -> (
    name: String, detail: String?, watts: String?, zone: PowerZone?
  ) {
    switch target {
    case nil: return ("Free ride", "Ride as you like", nil, nil)
    case .maxEffort: return ("Max effort", "All out", nil, .anaerobic)
    case .power("ftp", let level):
      let zone = PowerZone.zone(intensity: average(level))
      let watts = ftp.map { ftp in "\(Self.level(level, scale: Double(ftp))) W" }
      return (zone.name, "\(prefix(level))\(Self.level(level, scale: 100))% FTP", watts, zone)
    case .power(_, let level):
      let zone = ftp.map { PowerZone.zone(intensity: average(level) / Double($0)) }
      return (zone?.name ?? "Power", "\(prefix(level))\(Self.level(level, scale: 1)) W", nil, zone)
    case .heartRate("bpm", let level):
      return ("Heart rate", "\(prefix(level))\(Self.level(level, scale: 1)) bpm", nil, nil)
    case .heartRate(_, let level):
      return (
        "Heart rate", "\(prefix(level))\(Self.level(level, scale: 100))% threshold HR", nil, nil
      )
    case .pace(_, let level):
      return ("Pace", "\(prefix(level))\(Self.level(level, scale: 100)) pace", nil, nil)
    case .unknown(let type):
      return ("Unknown target", type, nil, nil)
    }
  }

  private static func prefix(_ level: TrainStackWorkout.Level) -> String {
    switch level {
    case .constant, .unknown: ""
    case .range: "Range "
    case .ramp: "Ramp "
    }
  }

  private static func average(_ level: TrainStackWorkout.Level) -> Double {
    switch level {
    case .constant(let value): value
    case .range(let low, let high), .ramp(let low, let high): (low + high) / 2
    case .unknown: 0
    }
  }

  private static func level(_ level: TrainStackWorkout.Level, scale: Double) -> String {
    let format = { (value: Double) in
      (value * scale).rounded().formatted(.number.grouping(.never).precision(.fractionLength(0)))
    }
    return switch level {
    case .constant(let value): format(value)
    case .range(let low, let high): "\(format(low))–\(format(high))"
    case .ramp(let from, let to): "\(format(from)) → \(format(to))"
    case .unknown(let kind): kind
    }
  }

  private static func duration(_ amount: TrainStackWorkout.Amount) -> String {
    switch amount {
    case .seconds(let seconds): seconds <= PlannedStep.longest ? seconds.clockString : "Over a day"
    case .meters(let meters):
      meters >= 1000 ? "\((meters / 1000).formatted(.oneDecimal)) km" : "\(Int(meters)) m"
    case .untilLap(let expected):
      expected.map { "Lap · about \(duration($0))" } ?? "Lap"
    case .unknown(let kind): kind
    }
  }
}
