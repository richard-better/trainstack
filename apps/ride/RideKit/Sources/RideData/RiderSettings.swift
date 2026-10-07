import Foundation

/// An FTP test the rider did, entered by hand.
public struct FTPTest: Codable, Equatable, Identifiable, Sendable {
  public enum Kind: String, CaseIterable, Codable, Sendable {
    case ramp, twentyMinute, eightMinute, hour, other

    public var name: String {
      switch self {
      case .ramp: "Ramp test"
      case .twentyMinute: "20-minute test"
      case .eightMinute: "8-minute test"
      case .hour: "Hour effort"
      case .other: "Other test"
      }
    }
  }

  public var id: UUID
  public var date: Date
  public var kind: Kind
  /// The FTP the test gave, in watts.
  public var ftp: Int
  /// The zones the test was for: Default, or a sport with its own power zones.
  public var scope: ZoneScope

  public init(
    id: UUID = UUID(), date: Date, kind: Kind, ftp: Int, scope: ZoneScope
  ) {
    self.id = id
    self.date = date
    self.kind = kind
    self.ftp = ftp
    self.scope = scope
  }
}

/// Everything a rider has set about their zones, as saved on this device.
public struct RiderSettings: Codable, Equatable, Sendable {
  public var history: ZoneHistory
  /// Oldest first.
  public private(set) var ftpTests: [FTPTest]

  public init(history: ZoneHistory = ZoneHistory(), ftpTests: [FTPTest] = []) {
    self.history = history
    self.ftpTests = ftpTests.sorted { $0.date < $1.date }
  }

  public func ftpTests(in scope: ZoneScope) -> [FTPTest] {
    ftpTests.filter { $0.scope == scope }
  }

  /// Adds a test, and when `updatesFTP`, makes its result the FTP from the day of the test.
  public mutating func add(_ test: FTPTest, updatesFTP: Bool, calendar: Calendar = .current) {
    ftpTests.append(test)
    ftpTests.sort { $0.date < $1.date }
    if updatesFTP {
      history.record(
        [.threshold(.ftp, scope: test.scope, value: test.ftp)], on: test.date, calendar: calendar)
    }
  }

  /// Removes a test. Any FTP it set stays in the zone history.
  public mutating func removeFTPTest(_ id: FTPTest.ID) {
    ftpTests.removeAll { $0.id == id }
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
