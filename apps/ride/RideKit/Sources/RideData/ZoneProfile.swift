import Foundation

/// How a set of zones is chosen: by a model, optionally with hand-edited limits.
public struct ZoneChoice: Codable, Equatable, Sendable {
  public var model: ZoneModel
  /// Hand-edited zone ends that replace the model's, or nil to follow the model. They stay put
  /// when thresholds change.
  public var customLimits: [Int]?

  public init(model: ZoneModel, customLimits: [Int]? = nil) {
    self.model = model
    self.customLimits = customLimits
  }

  public var isCustom: Bool { customLimits != nil }
}

/// Where zones apply: Default covers every sport without zones of its own.
public enum ZoneScope: Hashable, Codable, Sendable {
  case all
  case sport(Sport)

  public var sport: Sport? {
    if case .sport(let sport) = self { sport } else { nil }
  }
}

/// One metric's thresholds and how its zones are chosen.
public struct MetricZones: Codable, Equatable, Sendable {
  public var thresholds: [Threshold: Int]
  public var choice: ZoneChoice

  public init(thresholds: [Threshold: Int] = [:], choice: ZoneChoice) {
    self.thresholds = thresholds
    self.choice = choice
  }

  /// The zones, or nil when the chosen model needs a missing threshold.
  public var zones: ZoneSet? {
    let limits = choice.customLimits ?? choice.model.limits(from: thresholds)
    return limits.flatMap { ZoneSet(model: choice.model, limits: $0) }
  }

  /// The thresholds the chosen model needs and that are not set. None when the zones are custom.
  public var missingThresholds: [Threshold] {
    choice.isCustom ? [] : choice.model.basis.thresholds.filter { thresholds[$0] == nil }
  }
}

/// A rider's zones at one point in time: the Default zones, and the sports listed alongside them
/// with the metrics they keep their own zones for.
public struct ZoneProfile: Equatable, Sendable {
  /// Heart rate and power, the metrics every sport shares unless it has its own.
  public internal(set) var defaults: [ZoneMetric: MetricZones]
  /// The listed sports, each with the metrics it has its own zones for.
  public internal(set) var sports: [Sport: [ZoneMetric: MetricZones]]

  /// No thresholds, the standard models, and no sports listed.
  public init() {
    defaults = [:]
    for metric in [ZoneMetric.heartRate, .power] {
      if let model = ZoneModel.standard(for: metric, in: nil) {
        defaults[metric] = MetricZones(choice: ZoneChoice(model: model))
      }
    }
    sports = [:]
  }

  /// The listed sports, in the order sports are always shown.
  public var listedSports: [Sport] { Sport.allCases.filter { sports[$0] != nil } }

  /// The metrics a scope has zones for.
  public func metrics(in scope: ZoneScope) -> [ZoneMetric] {
    scope.sport?.metrics ?? [.heartRate, .power]
  }

  /// Whether `sport` follows the Default zones for `metric`. Pace has no Default.
  public func usesDefault(_ metric: ZoneMetric, in sport: Sport) -> Bool {
    metric != .pace && sports[sport]?[metric] == nil
  }

  /// The settings that apply to `metric` in `scope`: the sport's own, or else Default's.
  public func settings(for metric: ZoneMetric, in scope: ZoneScope) -> MetricZones? {
    if let sport = scope.sport, let own = sports[sport]?[metric] { return own }
    return metric == .pace ? nil : defaults[metric]
  }

  /// The zones for `metric` in an activity of `sport`, which uses Default when nil or unlisted.
  public func zones(for metric: ZoneMetric, in sport: Sport?) -> ZoneSet? {
    settings(for: metric, in: sport.map(ZoneScope.sport) ?? .all)?.zones
  }

  /// The threshold that applies in `scope`.
  public func value(of threshold: Threshold, in scope: ZoneScope) -> Int? {
    settings(for: threshold.metric, in: scope)?.thresholds[threshold]
  }

  mutating func apply(_ change: ZoneChange) {
    switch change {
    case .threshold(let threshold, let scope, let value):
      update(threshold.metric, in: scope) { $0.thresholds[threshold] = value }
    case .choice(let metric, let scope, let choice):
      update(metric, in: scope) { $0.choice = choice }
    case .ownZones(let metric, let sport, let isOwn):
      guard sports[sport] != nil, metric != .pace else { return }
      // Own zones start as a copy of Default's.
      let own = isOwn ? sports[sport]?[metric] ?? defaults[metric] : nil
      sports[sport]?[metric] = own
    case .listed(let sport, let isListed):
      guard isListed else {
        sports[sport] = nil
        return
      }
      guard sports[sport] == nil else { return }
      var own: [ZoneMetric: MetricZones] = [:]
      if sport.metrics.contains(.pace), let model = ZoneModel.standard(for: .pace, in: sport) {
        own[.pace] = MetricZones(choice: ZoneChoice(model: model))
      }
      sports[sport] = own
    }
  }

  /// Changes a scope's own settings for `metric`. Does nothing when the scope has none: a sport
  /// that uses Default, or is not listed.
  private mutating func update(
    _ metric: ZoneMetric, in scope: ZoneScope, _ change: (inout MetricZones) -> Void
  ) {
    switch scope {
    case .all:
      guard var zones = defaults[metric] else { return }
      change(&zones)
      defaults[metric] = zones
    case .sport(let sport):
      guard var zones = sports[sport]?[metric] else { return }
      change(&zones)
      sports[sport]?[metric] = zones
    }
  }
}
