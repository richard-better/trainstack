import Foundation

/// Everything a rider has set about their zones, as saved on this device.
public struct RiderSettings: Codable, Equatable, Sendable {
  public var history: ZoneHistory

  public init(history: ZoneHistory = ZoneHistory()) {
    self.history = history
  }

  private static let key = "riderSettings"

  /// The saved settings. Before zone history, Ride kept only a max heart rate and FTP, which
  /// become the first entry.
  public static func load(from defaults: UserDefaults, now: Date = .now) -> RiderSettings {
    if let data = defaults.data(forKey: key),
      let settings = try? JSONDecoder().decode(RiderSettings.self, from: data)
    {
      return settings
    }
    var settings = RiderSettings()
    let earlier: [(String, Threshold)] = [
      ("riderProfile.maxHeartRate", .maxHeartRate), ("riderProfile.ftp", .ftp),
    ]
    let changes = earlier.compactMap { key, threshold -> ZoneChange? in
      guard let value = defaults.object(forKey: key) as? Int, threshold.range.contains(value)
      else { return nil }
      return .threshold(threshold, scope: .all, value: value)
    }
    settings.history.record(changes, on: now)
    return settings
  }

  public func save(to defaults: UserDefaults) {
    defaults.set(try? JSONEncoder().encode(self), forKey: Self.key)
  }
}
