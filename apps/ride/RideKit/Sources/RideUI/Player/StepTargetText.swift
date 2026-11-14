import RideData

enum StepTargetText {
  static func value(_ level: TargetLevel) -> String {
    switch level {
    case .constant(let value): "\(Int(value.rounded()))"
    case .range(let low, let high): "\(Int(low.rounded()))–\(Int(high.rounded()))"
    case .ramp(let from, let to): "\(Int(from.rounded()))→\(Int(to.rounded()))"
    }
  }

  static func heartRate(_ target: StepTarget.HeartRate) -> (value: String, unit: String) {
    switch target {
    case .beatsPerMinute(let level): (value(level), "bpm")
    case .shareOfThreshold(let level): (value(level.scaled(by: 100)), "% threshold HR")
    }
  }

  static func cadence(_ level: TargetLevel) -> String { "\(value(level)) rpm" }
}
