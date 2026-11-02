import Foundation

public struct MetricZones: Codable, Equatable, Sendable {
  public var thresholds: [Threshold: Int]
  public var choice: ZoneChoice

  public init(thresholds: [Threshold: Int] = [:], choice: ZoneChoice) {
    self.thresholds = thresholds
    self.choice = choice
  }

  public var zones: ZoneSet? {
    let limits = choice.customLimits ?? choice.model.limits(from: thresholds)
    return limits.flatMap { ZoneSet(model: choice.model, limits: $0) }
  }

  public var missingThresholds: [Threshold] {
    choice.isCustom ? [] : choice.model.basis.thresholds.filter { thresholds[$0] == nil }
  }
}
