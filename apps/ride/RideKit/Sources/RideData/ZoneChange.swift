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
}
