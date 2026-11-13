import Foundation

public enum SettingKey: Hashable, Codable, Sendable {
  case threshold(sport: String?, threshold: String)
  case zones(sport: String?, metric: String)
  case ownZones(sport: String, metric: String)
  case sport(String)
  case weight
  case thresholdTest(id: String)

  private enum CodingKeys: String, CodingKey {
    case kind, sport, threshold, metric, id
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let kind = try container.decode(String.self, forKey: .kind)
    switch kind {
    case "threshold":
      self = .threshold(
        sport: try container.decode(String?.self, forKey: .sport),
        threshold: try container.decode(String.self, forKey: .threshold))
    case "zones":
      self = .zones(
        sport: try container.decode(String?.self, forKey: .sport),
        metric: try container.decode(String.self, forKey: .metric))
    case "own_zones":
      self = .ownZones(
        sport: try container.decode(String.self, forKey: .sport),
        metric: try container.decode(String.self, forKey: .metric))
    case "sport": self = .sport(try container.decode(String.self, forKey: .sport))
    case "weight": self = .weight
    case "threshold_test": self = .thresholdTest(id: try container.decode(String.self, forKey: .id))
    default:
      throw DecodingError.dataCorruptedError(
        forKey: .kind, in: container, debugDescription: "No setting is a \(kind)")
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .threshold(let sport, let threshold):
      try container.encode("threshold", forKey: .kind)
      try container.encode(sport, forKey: .sport)
      try container.encode(threshold, forKey: .threshold)
    case .zones(let sport, let metric):
      try container.encode("zones", forKey: .kind)
      try container.encode(sport, forKey: .sport)
      try container.encode(metric, forKey: .metric)
    case .ownZones(let sport, let metric):
      try container.encode("own_zones", forKey: .kind)
      try container.encode(sport, forKey: .sport)
      try container.encode(metric, forKey: .metric)
    case .sport(let sport):
      try container.encode("sport", forKey: .kind)
      try container.encode(sport, forKey: .sport)
    case .weight:
      try container.encode("weight", forKey: .kind)
    case .thresholdTest(let id):
      try container.encode("threshold_test", forKey: .kind)
      try container.encode(id, forKey: .id)
    }
  }
}
