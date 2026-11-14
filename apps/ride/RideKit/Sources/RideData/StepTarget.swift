public enum StepTarget: Hashable, Codable, Sendable {
  public enum HeartRate: Hashable, Codable, Sendable {
    case shareOfThreshold(TargetLevel)
    case beatsPerMinute(TargetLevel)
  }

  case power(TargetLevel)
  case heartRate(HeartRate)
  case maxEffort

  public func power(atShareOfStep share: Double) -> Int? {
    guard case .power(let level) = self else { return nil }
    return Int(level.value(atShareOfStep: share).rounded())
  }

  public var averagePower: Int? {
    guard case .power(let level) = self else { return nil }
    return Int(level.average.rounded())
  }

  public func zone(ftp: Int) -> PowerZone? {
    switch self {
    case .power: ftp > 0 ? averagePower.map { PowerZone.zone(power: $0, ftp: ftp) } : nil
    case .maxEffort: .anaerobic
    case .heartRate: nil
    }
  }
}
