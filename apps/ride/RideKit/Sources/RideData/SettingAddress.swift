import Foundation

public struct SettingAddress: Hashable, Comparable, Codable, Sendable {
  public var key: SettingKey
  public var day: SettingDay

  public init(_ key: SettingKey, on day: SettingDay) {
    self.key = key
    self.day = day
  }

  public static func < (lhs: SettingAddress, rhs: SettingAddress) -> Bool {
    (lhs.day, lhs.key.order) < (rhs.day, rhs.key.order)
  }
}

extension SettingKey {
  fileprivate var order: String {
    switch self {
    case .threshold(let sport, let threshold): "threshold/\(sport ?? "")/\(threshold)"
    case .zones(let sport, let metric): "zones/\(sport ?? "")/\(metric)"
    case .ownZones(let sport, let metric): "own_zones/\(sport)/\(metric)"
    case .sport(let sport): "sport/\(sport)"
    case .weight: "weight"
    case .thresholdTest(let id): "threshold_test/\(id)"
    }
  }
}
