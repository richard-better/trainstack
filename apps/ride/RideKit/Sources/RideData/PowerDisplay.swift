import Foundation

public enum PowerDisplay: String, CaseIterable, Codable, Sendable {
  case instant, threeSeconds, fiveSeconds

  public static let standard = PowerDisplay.threeSeconds

  public static let longestWindow = allCases.map(\.window).max() ?? 0

  public var name: String {
    switch self {
    case .instant: "Instant"
    case .threeSeconds: "3-second average"
    case .fiveSeconds: "5-second average"
    }
  }

  public var window: TimeInterval {
    switch self {
    case .instant: 0
    case .threeSeconds: 3
    case .fiveSeconds: 5
    }
  }

  private static let key = "powerDisplay"

  public static func load(from defaults: UserDefaults) -> PowerDisplay {
    defaults.string(forKey: key).flatMap(PowerDisplay.init(rawValue:)) ?? .standard
  }

  public func save(to defaults: UserDefaults) {
    defaults.set(rawValue, forKey: Self.key)
  }
}
