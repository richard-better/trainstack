import Foundation

public enum SettingChange: Equatable, Codable, Sendable {
  case threshold(sport: String?, threshold: String, value: Int?)
  case zones(sport: String?, metric: String, model: String, customLimits: [Int]?)
  case ownZones(sport: String, metric: String, own: Bool)
  case sport(String, listed: Bool)
  case weight(kg: Double)
  case thresholdTest(
    id: String, sport: String?, threshold: String, protocol: String, value: Int,
    activityID: String?)

  public var key: SettingKey {
    switch self {
    case .threshold(let sport, let threshold, _): .threshold(sport: sport, threshold: threshold)
    case .zones(let sport, let metric, _, _): .zones(sport: sport, metric: metric)
    case .ownZones(let sport, let metric, _): .ownZones(sport: sport, metric: metric)
    case .sport(let sport, _): .sport(sport)
    case .weight: .weight
    case .thresholdTest(let id, _, _, _, _, _): .thresholdTest(id: id)
    }
  }

  var unknownSportApplyOrder: Int {
    switch self {
    case .sport: 0
    case .ownZones: 2
    default: 3
    }
  }

  var isForASportRideDoesNotKnow: Bool {
    let sport: String? =
      switch self {
      case .threshold(let sport, _, _), .zones(let sport, _, _, _): sport
      case .ownZones(let sport, _, _), .sport(let sport, _): sport
      case .weight, .thresholdTest: nil
      }
    return sport.map { Sport(rawValue: $0) == nil } ?? false
  }

  private enum CodingKeys: String, CodingKey {
    case kind, sport, threshold, value, metric, model, customLimits, own, listed, kg, id
    case `protocol`, activityId
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    func string(_ key: CodingKeys) throws -> String {
      try container.decode(String.self, forKey: key)
    }
    func sport() throws -> String? { try container.decode(String?.self, forKey: .sport) }
    let kind = try string(.kind)
    switch kind {
    case "threshold":
      self = .threshold(
        sport: try sport(), threshold: try string(.threshold),
        value: try container.decode(Int?.self, forKey: .value))
    case "zones":
      self = .zones(
        sport: try sport(), metric: try string(.metric), model: try string(.model),
        customLimits: try container.decode([Int]?.self, forKey: .customLimits))
    case "own_zones":
      self = .ownZones(
        sport: try string(.sport), metric: try string(.metric),
        own: try container.decode(Bool.self, forKey: .own))
    case "sport":
      self = .sport(try string(.sport), listed: try container.decode(Bool.self, forKey: .listed))
    case "weight":
      self = .weight(kg: try container.decode(Double.self, forKey: .kg))
    case "threshold_test":
      self = .thresholdTest(
        id: try string(.id), sport: try sport(), threshold: try string(.threshold),
        protocol: try string(.protocol), value: try container.decode(Int.self, forKey: .value),
        activityID: try container.decode(String?.self, forKey: .activityId))
    default:
      throw DecodingError.dataCorruptedError(
        forKey: .kind, in: container, debugDescription: "No setting is a \(kind)")
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .threshold(let sport, let threshold, let value):
      try container.encode("threshold", forKey: .kind)
      try container.encode(sport, forKey: .sport)
      try container.encode(threshold, forKey: .threshold)
      try container.encode(value, forKey: .value)
    case .zones(let sport, let metric, let model, let customLimits):
      try container.encode("zones", forKey: .kind)
      try container.encode(sport, forKey: .sport)
      try container.encode(metric, forKey: .metric)
      try container.encode(model, forKey: .model)
      try container.encode(customLimits, forKey: .customLimits)
    case .ownZones(let sport, let metric, let own):
      try container.encode("own_zones", forKey: .kind)
      try container.encode(sport, forKey: .sport)
      try container.encode(metric, forKey: .metric)
      try container.encode(own, forKey: .own)
    case .sport(let sport, let listed):
      try container.encode("sport", forKey: .kind)
      try container.encode(sport, forKey: .sport)
      try container.encode(listed, forKey: .listed)
    case .weight(let kg):
      try container.encode("weight", forKey: .kind)
      try container.encode(kg, forKey: .kg)
    case .thresholdTest(let id, let sport, let threshold, let method, let value, let activityID):
      try container.encode("threshold_test", forKey: .kind)
      try container.encode(id, forKey: .id)
      try container.encode(sport, forKey: .sport)
      try container.encode(threshold, forKey: .threshold)
      try container.encode(method, forKey: .protocol)
      try container.encode(value, forKey: .value)
      try container.encode(activityID, forKey: .activityId)
    }
  }
}
