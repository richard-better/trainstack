import Foundation

/// How the player shows power: each reading as it comes, or averaged over a few seconds so a
/// moment off the pedals does not throw the number around. Charts and recordings keep every
/// reading.
public enum PowerDisplay: String, CaseIterable, Codable, Sendable {
  case instant, threeSeconds, fiveSeconds

  public static let standard = PowerDisplay.threeSeconds

  /// The longest window of any choice.
  public static let longestWindow: TimeInterval = 5

  public var name: String {
    switch self {
    case .instant: "Instant"
    case .threeSeconds: "3-second average"
    case .fiveSeconds: "5-second average"
    }
  }

  /// Seconds averaged over, or 0 for each reading as it comes.
  public var window: TimeInterval {
    switch self {
    case .instant: 0
    case .threeSeconds: 3
    case .fiveSeconds: 5
    }
  }

  private static let key = "powerDisplay"

  /// The saved choice, or `standard` if there is none.
  public static func load(from defaults: UserDefaults) -> PowerDisplay {
    defaults.string(forKey: key).flatMap(PowerDisplay.init(rawValue:)) ?? .standard
  }

  public func save(to defaults: UserDefaults) {
    defaults.set(rawValue, forKey: Self.key)
  }
}
