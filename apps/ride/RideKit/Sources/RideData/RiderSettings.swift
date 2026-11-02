import Foundation

public struct RiderSettings: Codable, Equatable, Sendable {
  public var history: ZoneHistory
  public private(set) var ftpTests: [FTPTest]
  public private(set) var weight = Self.defaultWeight

  public static let defaultWeight = 75.0
  public static let weightRange = 30.0...200.0

  public init(history: ZoneHistory = ZoneHistory(), ftpTests: [FTPTest] = []) {
    self.history = history
    self.ftpTests = ftpTests.sorted { $0.date < $1.date }
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    history = try container.decode(ZoneHistory.self, forKey: .history)
    ftpTests = try container.decode([FTPTest].self, forKey: .ftpTests)
    weight = try container.decodeIfPresent(Double.self, forKey: .weight) ?? Self.defaultWeight
  }

  public mutating func setWeight(_ weight: Double) {
    guard Self.weightRange.contains(weight) else { return }
    self.weight = weight
  }

  public func ftpTests(in scope: ZoneScope) -> [FTPTest] {
    ftpTests.filter { $0.scope == scope }
  }

  public mutating func add(_ test: FTPTest, updatesFTP: Bool, calendar: Calendar = .current) {
    ftpTests.append(test)
    ftpTests.sort { $0.date < $1.date }
    if updatesFTP {
      history.record(
        [.threshold(.ftp, scope: test.scope, value: test.ftp)], on: test.date, calendar: calendar)
    }
  }

  public mutating func removeFTPTest(_ id: FTPTest.ID) {
    ftpTests.removeAll { $0.id == id }
  }

  private static let key = "riderSettings"

  public static func load(from defaults: UserDefaults, now: Date = .now) -> RiderSettings {
    if let data = defaults.data(forKey: key),
      let settings = try? JSONDecoder().decode(RiderSettings.self, from: data)
    {
      return settings
    }
    var settings = RiderSettings()
    let savedBeforeZoneHistory: [(String, Threshold)] = [
      ("riderProfile.maxHeartRate", .maxHeartRate), ("riderProfile.ftp", .ftp),
    ]
    let changes = savedBeforeZoneHistory.compactMap { key, threshold -> ZoneChange? in
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
