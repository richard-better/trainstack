import Foundation

public enum HeartRateSource: String, CaseIterable, Codable, Sendable {
  case chestStrap, watch, simulated

  public var name: String {
    switch self {
    case .chestStrap: "Chest strap"
    case .watch: "Apple Watch"
    case .simulated: "Simulated"
    }
  }
}
