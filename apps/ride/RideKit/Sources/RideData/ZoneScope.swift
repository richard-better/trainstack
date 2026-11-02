import Foundation

public enum ZoneScope: Hashable, Codable, Sendable {
  case all
  case sport(Sport)

  public var sport: Sport? {
    if case .sport(let sport) = self { sport } else { nil }
  }
}
