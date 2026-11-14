public enum PlannedTarget: Hashable, Codable, Sendable {
  case shareOfFTP(TargetLevel)
  case watts(TargetLevel)
  case shareOfThresholdHeartRate(TargetLevel)
  case beatsPerMinute(TargetLevel)
  case maxEffort

  public func resolved(ftp: Int) -> StepTarget {
    switch self {
    case .shareOfFTP(let level): .power(level.scaled(by: Double(ftp)))
    case .watts(let level): .power(level)
    case .shareOfThresholdHeartRate(let level): .heartRate(.shareOfThreshold(level))
    case .beatsPerMinute(let level): .heartRate(.beatsPerMinute(level))
    case .maxEffort: .maxEffort
    }
  }
}
