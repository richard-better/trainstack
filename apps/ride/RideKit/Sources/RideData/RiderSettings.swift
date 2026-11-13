import Foundation

public struct RiderSettings: Codable, Equatable, Sendable {
  public private(set) var ledger: SettingsLedger
  public private(set) var history = ZoneHistory()
  public private(set) var ftpTests: [FTPTest] = []
  public private(set) var weight = Self.defaultWeight
  private let calendar: Calendar

  public static let defaultWeight = 75.0
  public static let weightRange = 30.0...200.0

  public init(ledger: SettingsLedger = SettingsLedger(), calendar: Calendar = .current) {
    self.ledger = ledger
    self.calendar = calendar
    derive()
  }

  public static func == (lhs: RiderSettings, rhs: RiderSettings) -> Bool {
    lhs.ledger == rhs.ledger
  }

  private enum CodingKeys: String, CodingKey { case ledger }

  private enum SavedBeforeTheLedger: String, CodingKey { case history, ftpTests, weight }

  public init(from decoder: any Decoder) throws {
    calendar = .current
    if let ledger = try decoder.container(keyedBy: CodingKeys.self)
      .decodeIfPresent(SettingsLedger.self, forKey: .ledger)
    {
      self.ledger = ledger
    } else {
      let saved = try decoder.container(keyedBy: SavedBeforeTheLedger.self)
      ledger = Self.migrated(
        history: try saved.decode(ZoneHistory.self, forKey: .history),
        ftpTests: try saved.decode([FTPTest].self, forKey: .ftpTests),
        weight: try saved.decodeIfPresent(Double.self, forKey: .weight) ?? Self.defaultWeight,
        calendar: calendar)
    }
    derive()
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(ledger, forKey: .ledger)
  }

  static func migrated(
    history: ZoneHistory, ftpTests: [FTPTest], weight: Double, calendar: Calendar
  ) -> SettingsLedger {
    var ledger = SettingsLedger()
    for (address, change) in history.settings(calendar: calendar) {
      ledger.migrate(address, to: change)
    }
    for test in ftpTests {
      let day = SettingDay(test.date, calendar: calendar)
      ledger.migrate(SettingAddress(test.setting.key, on: day), to: test.setting)
    }
    if weight != defaultWeight, weightRange.contains(weight) {
      let day = history.entries.first.map { SettingDay($0.day, calendar: calendar) }
      ledger.migrate(
        SettingAddress(.weight, on: day ?? SettingDay(.now, calendar: calendar)),
        to: .weight(kg: weight))
    }
    return ledger
  }

  private mutating func derive() {
    var zoneChanges: [(day: SettingDay, change: ZoneChange)] = []
    var tests: [FTPTest] = []
    var latestWeight: (day: SettingDay, kg: Double)?
    for (address, change) in ledger.live {
      if let zoneChange = ZoneChange(change) {
        zoneChanges.append((address.day, zoneChange))
      } else if let test = FTPTest(change, on: address.day, calendar: calendar) {
        tests.append(test)
      } else if case .weight(let kg) = change, latestWeight.map({ $0.day < address.day }) ?? true {
        latestWeight = (address.day, kg)
      }
    }
    history = ZoneHistory(zoneChanges, calendar: calendar)
    ftpTests = tests.sorted { ($0.date, $0.id.uuidString) < ($1.date, $1.id.uuidString) }
    weight = latestWeight?.kg ?? Self.defaultWeight
  }

  private mutating func edit(at now: Date, _ change: (inout ZoneHistory, Calendar) -> Void) {
    let before = history.settings(calendar: calendar)
    var edited = history
    change(&edited, calendar)
    let after = edited.settings(calendar: calendar)
    for address in Set(before.keys).union(after.keys) where before[address] != after[address] {
      ledger.edit(address, to: after[address], at: now)
    }
    derive()
  }

  public mutating func record(
    _ changes: [ZoneChange], on date: Date, at now: Date = .now
  ) {
    edit(at: now) { $0.record(changes, on: date, calendar: $1) }
  }

  public mutating func moveHistoryEntry(
    _ id: ZoneHistory.Entry.ID, to date: Date, at now: Date = .now
  ) {
    edit(at: now) { $0.move(id, to: date, calendar: $1) }
  }

  public mutating func removeHistoryEntry(_ id: ZoneHistory.Entry.ID, at now: Date = .now) {
    edit(at: now) { history, _ in history.remove(id) }
  }

  public mutating func setWeight(_ weight: Double, at now: Date = .now) {
    guard Self.weightRange.contains(weight), weight != self.weight else { return }
    ledger.edit(
      SettingAddress(.weight, on: SettingDay(now, calendar: calendar)), to: .weight(kg: weight),
      at: now)
    derive()
  }

  public func ftpTests(in scope: ZoneScope) -> [FTPTest] {
    ftpTests.filter { $0.scope == scope }
  }

  public mutating func add(_ test: FTPTest, updatesFTP: Bool, at now: Date = .now) {
    let day = SettingDay(test.date, calendar: calendar)
    ledger.edit(SettingAddress(test.setting.key, on: day), to: test.setting, at: now)
    if updatesFTP {
      record([.threshold(.ftp, scope: test.scope, value: test.ftp)], on: test.date, at: now)
    } else {
      derive()
    }
  }

  public mutating func removeFTPTest(_ id: FTPTest.ID, at now: Date = .now) {
    guard
      let (address, _) = ledger.live.first(where: { _, change in
        guard case .thresholdTest(let testID, _, _, _, _, _) = change else { return false }
        return UUID(uuidString: testID) == id
      })
    else { return }
    ledger.edit(address, to: nil, at: now)
    derive()
  }

  public mutating func receive(_ writes: [SettingWrite], through cursor: String?) {
    for write in writes { ledger.receive(write) }
    if let cursor { ledger.received(through: cursor) }
    derive()
  }

  public mutating func claim(for account: String) {
    ledger.claim(for: account)
  }

  public mutating func forgetAccount() {
    ledger.forgetAccount()
    derive()
  }

  private static let key = "riderSettings"

  public static func load(from defaults: UserDefaults, now: Date = .now) -> RiderSettings {
    if let data = defaults.data(forKey: key),
      let settings = try? JSONDecoder().decode(RiderSettings.self, from: data)
    {
      return settings
    }
    var history = ZoneHistory()
    let savedBeforeZoneHistory: [(String, Threshold)] = [
      ("riderProfile.maxHeartRate", .maxHeartRate), ("riderProfile.ftp", .ftp),
    ]
    let changes = savedBeforeZoneHistory.compactMap { key, threshold -> ZoneChange? in
      guard let value = defaults.object(forKey: key) as? Int, threshold.range.contains(value)
      else { return nil }
      return .threshold(threshold, scope: .all, value: value)
    }
    history.record(changes, on: now)
    return RiderSettings(
      ledger: migrated(history: history, ftpTests: [], weight: defaultWeight, calendar: .current))
  }

  public func save(to defaults: UserDefaults) {
    defaults.set(try? JSONEncoder().encode(self), forKey: Self.key)
  }
}
