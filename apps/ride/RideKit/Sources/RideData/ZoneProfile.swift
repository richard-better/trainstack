import Foundation

public struct ZoneProfile: Equatable, Sendable {
  public internal(set) var defaults: [ZoneMetric: MetricZones]
  public internal(set) var sports: [Sport: [ZoneMetric: MetricZones]]
  var unknownSports: [String: [String: UnknownSportZones]] = [:]

  public init() {
    defaults = [:]
    for metric in [ZoneMetric.heartRate, .power] {
      if let model = ZoneModel.standard(for: metric, in: nil) {
        defaults[metric] = MetricZones(choice: ZoneChoice(model: model))
      }
    }
    sports = [:]
  }

  public var listedSports: [Sport] { Sport.allCases.filter { sports[$0] != nil } }

  public func metrics(in scope: ZoneScope) -> [ZoneMetric] {
    scope.sport?.metrics ?? [.heartRate, .power]
  }

  public func usesDefault(_ metric: ZoneMetric, in sport: Sport) -> Bool {
    metric != .pace && sports[sport]?[metric] == nil
  }

  public func settings(for metric: ZoneMetric, in scope: ZoneScope) -> MetricZones? {
    if let sport = scope.sport, let own = sports[sport]?[metric] { return own }
    return metric == .pace ? nil : defaults[metric]
  }

  public func zones(for metric: ZoneMetric, in sport: Sport?) -> ZoneSet? {
    settings(for: metric, in: sport.map(ZoneScope.sport) ?? .all)?.zones
  }

  public func value(of threshold: Threshold, in scope: ZoneScope) -> Int? {
    settings(for: threshold.metric, in: scope)?.thresholds[threshold]
  }

  mutating func apply(_ change: ZoneChange) {
    switch change {
    case .threshold(let threshold, let scope, let value):
      updateOwnSettings(threshold.metric, in: scope) { $0.thresholds[threshold] = value }
    case .choice(let metric, let scope, let choice):
      updateOwnSettings(metric, in: scope) { $0.choice = choice }
    case .ownZones(let metric, let sport, let isOwn):
      guard sports[sport] != nil, metric != .pace else { return }
      let ownStartingAsACopyOfDefault = isOwn ? sports[sport]?[metric] ?? defaults[metric] : nil
      sports[sport]?[metric] = ownStartingAsACopyOfDefault
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

  mutating func apply(unknownSport change: SettingChange) {
    switch change {
    case .sport(let sport, let listed):
      if !listed {
        unknownSports[sport] = nil
      } else if unknownSports[sport] == nil {
        unknownSports[sport] = [:]
      }
    case .ownZones(let sport, let metric, let own):
      guard unknownSports[sport] != nil, metric != ZoneMetric.pace.wireName else { return }
      guard own else {
        unknownSports[sport]?[metric] = nil
        return
      }
      guard unknownSports[sport]?[metric] == nil,
        let defaults = ZoneMetric(wireName: metric).flatMap({ defaults[$0] })
      else { return }
      unknownSports[sport]?[metric] = UnknownSportZones(copying: defaults)
    case .threshold(let sport?, let threshold, let value):
      guard let metric = Threshold(wireName: threshold)?.metric.wireName,
        unknownSports[sport]?[metric] != nil
      else { return }
      unknownSports[sport]?[metric]?.thresholds[threshold] = value
    case .zones(let sport?, let metric, let model, let customLimits):
      guard unknownSports[sport]?[metric] != nil else { return }
      unknownSports[sport]?[metric]?.model = model
      unknownSports[sport]?[metric]?.customLimits = customLimits
    default:
      return
    }
  }

  private mutating func updateOwnSettings(
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
