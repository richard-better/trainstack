import Foundation

/// What a rider's zones and training stress are measured against.
public struct RiderProfile: Equatable, Sendable {
  public static let maxHeartRateRange = 100...230
  public static let ftpRange = 50...600

  /// Beats per minute.
  public var maxHeartRate: Int?
  /// Functional threshold power, in watts.
  public var ftp: Int?

  public init(maxHeartRate: Int? = nil, ftp: Int? = nil) {
    self.maxHeartRate = maxHeartRate
    self.ftp = ftp
  }

  private enum Key {
    static let maxHeartRate = "riderProfile.maxHeartRate"
    static let ftp = "riderProfile.ftp"
  }

  /// The saved profile. A saved value outside its range is dropped, as if never set.
  public static func load(from defaults: UserDefaults) -> RiderProfile {
    func value(_ key: String, in range: ClosedRange<Int>) -> Int? {
      let stored = defaults.object(forKey: key) as? Int
      return stored.flatMap { range.contains($0) ? $0 : nil }
    }
    return RiderProfile(
      maxHeartRate: value(Key.maxHeartRate, in: maxHeartRateRange),
      ftp: value(Key.ftp, in: ftpRange))
  }

  public func save(to defaults: UserDefaults) {
    for (key, value) in [(Key.maxHeartRate, maxHeartRate), (Key.ftp, ftp)] {
      if let value { defaults.set(value, forKey: key) } else { defaults.removeObject(forKey: key) }
    }
  }
}
