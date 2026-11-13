import Foundation

public enum ZoneMetric: String, CaseIterable, Codable, Sendable {
  case heartRate, power, pace

  public var wireName: String {
    switch self {
    case .heartRate: "heart_rate"
    case .power: "power"
    case .pace: "pace"
    }
  }

  public init?(wireName: String) {
    guard let metric = Self.allCases.first(where: { $0.wireName == wireName }) else { return nil }
    self = metric
  }

  public var isDescending: Bool { self == .pace }
}
