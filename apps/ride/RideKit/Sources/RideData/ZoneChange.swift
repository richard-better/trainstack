import Foundation

public enum ZoneChange: Codable, Equatable, Identifiable, Sendable {
  case threshold(Threshold, scope: ZoneScope, value: Int?)
  case choice(ZoneMetric, scope: ZoneScope, ZoneChoice)
  case ownZones(ZoneMetric, sport: Sport, Bool)
  case listed(Sport, Bool)

  public enum Key: Hashable, Sendable {
    case threshold(Threshold, ZoneScope)
    case choice(ZoneMetric, ZoneScope)
    case ownZones(ZoneMetric, Sport)
    case listed(Sport)
  }

  public var id: Key { key }

  var key: Key {
    switch self {
    case .threshold(let threshold, let scope, _): .threshold(threshold, scope)
    case .choice(let metric, let scope, _): .choice(metric, scope)
    case .ownZones(let metric, let sport, _): .ownZones(metric, sport)
    case .listed(let sport, _): .listed(sport)
    }
  }

  var applyOrder: Int {
    switch self {
    case .listed: 0
    case .threshold(_, .all, _), .choice(_, .all, _): 1
    case .ownZones: 2
    case .threshold, .choice: 3
    }
  }

  public var setting: SettingChange {
    switch self {
    case .threshold(let threshold, let scope, let value):
      .threshold(sport: scope.wireSport, threshold: threshold.wireName, value: value)
    case .choice(let metric, let scope, let choice):
      .zones(
        sport: scope.wireSport, metric: metric.wireName, model: choice.model.wireName,
        customLimits: choice.customLimits)
    case .ownZones(let metric, let sport, let own):
      .ownZones(sport: sport.rawValue, metric: metric.wireName, own: own)
    case .listed(let sport, let listed):
      .sport(sport.rawValue, listed: listed)
    }
  }

  public init?(_ setting: SettingChange) {
    switch setting {
    case .threshold(let sport, let threshold, let value):
      guard let scope = ZoneScope(wireSport: sport), let threshold = Threshold(wireName: threshold)
      else { return nil }
      self = .threshold(threshold, scope: scope, value: value)
    case .zones(let sport, let metric, let model, let customLimits):
      guard let scope = ZoneScope(wireSport: sport), let metric = ZoneMetric(wireName: metric),
        let model = ZoneModel(wireName: model), model.metric == metric
      else { return nil }
      self = .choice(metric, scope: scope, ZoneChoice(model: model, customLimits: customLimits))
    case .ownZones(let sport, let metric, let own):
      guard let sport = Sport(rawValue: sport), let metric = ZoneMetric(wireName: metric) else {
        return nil
      }
      self = .ownZones(metric, sport: sport, own)
    case .sport(let sport, let listed):
      guard let sport = Sport(rawValue: sport) else { return nil }
      self = .listed(sport, listed)
    case .weight, .thresholdTest:
      return nil
    }
  }
}
