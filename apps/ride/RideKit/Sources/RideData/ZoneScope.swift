import Foundation

public enum ZoneScope: Hashable, Codable, Sendable {
  case all
  case sport(Sport)

  public var sport: Sport? {
    if case .sport(let sport) = self { sport } else { nil }
  }

  var wireSport: String? { sport?.rawValue }

  init?(wireSport: String?) {
    guard let wireSport else {
      self = .all
      return
    }
    guard let sport = Sport(rawValue: wireSport) else { return nil }
    self = .sport(sport)
  }
}
