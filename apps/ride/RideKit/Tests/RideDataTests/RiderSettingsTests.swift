import Foundation
import Testing

@testable import RideData

struct RiderSettingsTests {
  private let calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
  }()

  private func freshDefaults() throws -> UserDefaults {
    let name = "RiderSettingsTests-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: name))
    defaults.removePersistentDomain(forName: name)
    return defaults
  }

  private func day(_ month: Int, _ day: Int, hour: Int = 12) -> Date {
    calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour))!
  }

  private func settingDay(_ month: Int, _ day: Int) -> SettingDay {
    SettingDay(self.day(month, day), calendar: calendar)
  }

  private let ftpKey = SettingKey.threshold(sport: nil, threshold: "ftp")

  @Test func startsEmpty() throws {
    let settings = RiderSettings.load(from: try freshDefaults())
    #expect(settings == RiderSettings())
    #expect(settings.history.current.value(of: .ftp, in: .all) == nil)
  }

  @Test func savesAndLoads() throws {
    let defaults = try freshDefaults()
    var settings = RiderSettings()
    settings.record([.threshold(.ftp, scope: .all, value: 220)], on: .now)
    settings.add(
      FTPTest(date: .now, kind: .ramp, ftp: 230, scope: .all), updatesFTP: false)
    settings.setWeight(68.5)
    settings.save(to: defaults)
    let loaded = RiderSettings.load(from: defaults)
    #expect(loaded == settings)
    #expect(loaded.weight == 68.5)
    #expect(loaded.ftpTests.map(\.ftp) == [230])
    #expect(loaded.history.current.value(of: .ftp, in: .all) == 220)
  }

  @Test func weighsTheDefaultUntilSet() {
    var settings = RiderSettings()
    #expect(settings.weight == 75)
    settings.setWeight(82)
    settings.setWeight(5)
    #expect(settings.weight == 82)
  }

  @Test func weighsTheLatestDaysWeight() {
    var settings = RiderSettings(calendar: calendar)
    settings.setWeight(70, at: day(3, 1))
    settings.setWeight(72, at: day(6, 1))
    #expect(settings.weight == 72)
    settings.receive(
      [
        SettingWrite(
          SettingAddress(.weight, on: settingDay(4, 1)), .weight(kg: 90), at: .init(day(9, 1)))
      ],
      through: nil)
    #expect(settings.weight == 72)
  }

  private func savedBeforeTheLedger(
    _ history: ZoneHistory, ftpTests: [FTPTest] = [], weight: Double? = nil
  ) throws -> Data {
    var saved: [String: Any] = [
      "history": try JSONSerialization.jsonObject(with: JSONEncoder().encode(history)),
      "ftpTests": try JSONSerialization.jsonObject(with: JSONEncoder().encode(ftpTests)),
    ]
    if let weight { saved["weight"] = weight }
    return try JSONSerialization.data(withJSONObject: saved)
  }

  @Test func loadsSettingsSavedBeforeRiderWeightWithTheDefault() throws {
    let defaults = try freshDefaults()
    var history = ZoneHistory()
    history.record([.threshold(.ftp, scope: .all, value: 220)], on: .now)
    defaults.set(try savedBeforeTheLedger(history), forKey: "riderSettings")
    let loaded = RiderSettings.load(from: defaults)
    #expect(loaded.weight == 75)
    #expect(loaded.history.current.value(of: .ftp, in: .all) == 220)
  }

  @Test func bringsSettingsSavedBeforeTheLedgerOverAsUnsentEditsOlderThanAnyRealOne() throws {
    let defaults = try freshDefaults()
    var history = ZoneHistory()
    history.record(
      [.threshold(.ftp, scope: .all, value: 220), .listed(.running, true)], on: .now)
    let test = FTPTest(date: .now, kind: .twentyMinute, ftp: 230, scope: .all)
    defaults.set(
      try savedBeforeTheLedger(history, ftpTests: [test], weight: 68), forKey: "riderSettings")
    let loaded = RiderSettings.load(from: defaults)
    #expect(loaded.history.current.value(of: .ftp, in: .all) == 220)
    #expect(loaded.history.current.listedSports == [.running])
    #expect(loaded.ftpTests.map(\.id) == [test.id])
    #expect(loaded.weight == 68)
    #expect(loaded.ledger.unsent.count == 4)
    #expect(loaded.ledger.unsent.allSatisfy { $0.updatedAt == .beforeAnyEdit })
    #expect(loaded.ledger.account == nil)
  }

  @Test func leavesTheDefaultWeightOutWhenBringingSettingsOver() throws {
    let defaults = try freshDefaults()
    defaults.set(try savedBeforeTheLedger(ZoneHistory(), weight: 75), forKey: "riderSettings")
    #expect(RiderSettings.load(from: defaults).ledger.unsent.isEmpty)
  }

  @Test func bringsOverTheValuesSavedBeforeZoneHistory() throws {
    let defaults = try freshDefaults()
    defaults.set(186, forKey: "riderProfile.maxHeartRate")
    defaults.set(100_000, forKey: "riderProfile.ftp")
    let settings = RiderSettings.load(from: defaults)
    #expect(settings.history.current.value(of: .maxHeartRate, in: .all) == 186)
    #expect(settings.history.current.value(of: .ftp, in: .all) == nil)
    #expect(settings.ledger.unsent.map(\.updatedAt) == [.beforeAnyEdit])
  }

  @Test func keepsFTPTestsOldestFirst() {
    var settings = RiderSettings()
    settings.add(FTPTest(date: .now, kind: .ramp, ftp: 210, scope: .all), updatesFTP: false)
    settings.add(
      FTPTest(date: .now.addingTimeInterval(-90 * 86400), kind: .ramp, ftp: 200, scope: .all),
      updatesFTP: false)
    settings.add(
      FTPTest(date: .now.addingTimeInterval(-86400), kind: .hour, ftp: 205, scope: .all),
      updatesFTP: false)
    #expect(settings.ftpTests.map(\.ftp) == [200, 205, 210])
  }

  @Test func setsFTPFromATestOnTheDayOfTheTest() throws {
    var settings = RiderSettings()
    settings.record([.threshold(.ftp, scope: .all, value: 200)], on: .distantPast)
    let testDay = Date.now.addingTimeInterval(-10 * 86400)
    settings.add(
      FTPTest(date: testDay, kind: .twentyMinute, ftp: 215, scope: .all), updatesFTP: true)
    settings.add(FTPTest(date: .now, kind: .other, ftp: 230, scope: .all), updatesFTP: false)
    #expect(settings.ftpTests(in: .all).map(\.ftp) == [215, 230])
    #expect(settings.history.profile(on: testDay).value(of: .ftp, in: .all) == 215)
    #expect(settings.history.current.value(of: .ftp, in: .all) == 215)
    settings.removeFTPTest(try #require(settings.ftpTests.first?.id))
    #expect(settings.ftpTests.map(\.ftp) == [230])
    #expect(settings.history.current.value(of: .ftp, in: .all) == 215)
  }

  @Test func stampsEachEditWithTheMomentItWasMade() {
    var settings = RiderSettings(calendar: calendar)
    let madeAt = day(6, 1, hour: 9).addingTimeInterval(0.1234)
    settings.record([.threshold(.ftp, scope: .all, value: 250)], on: day(5, 1), at: madeAt)
    #expect(
      settings.ledger.unsent == [
        SettingWrite(
          SettingAddress(ftpKey, on: settingDay(5, 1)),
          .threshold(sport: nil, threshold: "ftp", value: 250),
          at: SettingStamp(milliseconds: Int64(madeAt.timeIntervalSince1970 * 1000)))
      ])
  }

  @Test func movingAnEntryRemovesItFromItsDayAndPutsItOnTheNewOne() throws {
    var settings = RiderSettings(calendar: calendar)
    settings.record([.threshold(.ftp, scope: .all, value: 250)], on: day(5, 1), at: day(5, 1))
    settings.moveHistoryEntry(
      try #require(settings.history.entries.first?.id), to: day(4, 1), at: day(5, 2))
    let writes = settings.ledger.unsent
    #expect(writes.map(\.address.day) == [settingDay(4, 1), settingDay(5, 1)])
    #expect(writes.map(\.isRemoval) == [false, true])
    #expect(settings.history.entries.map(\.day) == [calendar.startOfDay(for: day(4, 1))])
  }

  @Test func removingAnFTPTestLeavesARemoval() throws {
    var settings = RiderSettings(calendar: calendar)
    let test = FTPTest(date: day(5, 1), kind: .ramp, ftp: 250, scope: .sport(.cycling))
    settings.add(test, updatesFTP: false, at: day(5, 1))
    settings.removeFTPTest(test.id, at: day(5, 2))
    #expect(settings.ftpTests.isEmpty)
    #expect(
      settings.ledger.unsent.map(\.address) == [
        SettingAddress(.thresholdTest(id: test.id.uuidString.lowercased()), on: settingDay(5, 1))
      ])
    #expect(settings.ledger.unsent.map(\.isRemoval) == [true])
  }

  @Test func takesInWhatOtherDevicesWrote() {
    var settings = RiderSettings(calendar: calendar)
    let id = UUID()
    settings.receive(
      [
        SettingWrite(
          SettingAddress(ftpKey, on: settingDay(5, 1)),
          .threshold(sport: nil, threshold: "ftp", value: 260), at: .init(day(5, 1))),
        SettingWrite(
          SettingAddress(.thresholdTest(id: id.uuidString), on: settingDay(5, 1)),
          .thresholdTest(
            id: id.uuidString, sport: "cycling", threshold: "ftp", protocol: "detected", value: 262,
            activityID: nil), at: .init(day(5, 1))),
        SettingWrite(
          SettingAddress(.weight, on: settingDay(5, 1)), .weight(kg: 64), at: .init(day(5, 1))),
      ], through: "7")
    #expect(settings.history.current.value(of: .ftp, in: .all) == 260)
    #expect(
      settings.ftpTests == [
        FTPTest(id: id, date: day(5, 1, hour: 0), kind: .other, ftp: 262, scope: .sport(.cycling))
      ])
    #expect(settings.weight == 64)
    #expect(settings.ledger.cursor == "7")
    #expect(settings.ledger.unsent.isEmpty)
  }

  @Test func keepsSettingsThisAppCannotShowWithoutLettingThemChangeWhatItShows() {
    var settings = RiderSettings(calendar: calendar)
    let unknown = [
      SettingChange.sport("bouldering", listed: true),
      .threshold(sport: "triathlon", threshold: "ftp", value: 250),
      .threshold(sport: nil, threshold: "critical_power", value: 250),
      .zones(sport: nil, metric: "power", model: "seiler_5", customLimits: nil),
      .thresholdTest(
        id: UUID().uuidString, sport: nil, threshold: "threshold_pace", protocol: "other",
        value: 300, activityID: nil),
    ]
    settings.receive(
      unknown.map {
        SettingWrite(SettingAddress($0.key, on: settingDay(5, 1)), $0, at: .init(day(5, 1)))
      }, through: nil)
    #expect(settings.history.entries.flatMap(\.changes).isEmpty)
    #expect(settings.history.current.listedSports.isEmpty)
    #expect(settings.history.current.value(of: .ftp, in: .all) == nil)
    #expect(settings.ftpTests.isEmpty)
    #expect(settings.ledger.live.count == unknown.count)
  }

  @Test func appliesChangesOnOneDayInTheServersOrderWhateverOrderTheyArrived() {
    let changes: [SettingChange] = [
      .threshold(sport: "running", threshold: "ftp", value: 300),
      .ownZones(sport: "running", metric: "power", own: true),
      .threshold(sport: nil, threshold: "ftp", value: 250),
      .sport("running", listed: true),
    ]
    let writes = changes.map {
      SettingWrite(SettingAddress($0.key, on: settingDay(5, 1)), $0, at: .init(day(5, 1)))
    }
    for order in [writes, writes.reversed()] {
      var settings = RiderSettings(calendar: calendar)
      settings.receive(order, through: nil)
      #expect(settings.history.current.value(of: .ftp, in: .sport(.running)) == 300)
      #expect(settings.history.current.value(of: .ftp, in: .all) == 250)
    }
  }

  @Test func forgettingTheAccountKeepsTheSettingsToSendToTheNextOne() {
    var settings = RiderSettings(calendar: calendar)
    settings.claim(for: "ada")
    settings.receive(
      [
        SettingWrite(
          SettingAddress(ftpKey, on: settingDay(5, 1)),
          .threshold(sport: nil, threshold: "ftp", value: 260), at: .init(day(5, 1))),
        SettingWrite(SettingAddress(.weight, on: settingDay(5, 2)), nil, at: .init(day(5, 2))),
      ], through: "3")
    settings.forgetAccount()
    #expect(settings.ledger.account == nil)
    #expect(settings.ledger.cursor == nil)
    #expect(settings.ledger.unsent.map(\.address) == [SettingAddress(ftpKey, on: settingDay(5, 1))])
    #expect(settings.history.current.value(of: .ftp, in: .all) == 260)
  }

  @Test func anEditLeavesTheOtherSettingsOfItsDayAlone() {
    var settings = RiderSettings(calendar: calendar)
    settings.receive(
      [
        SettingWrite(
          SettingAddress(ftpKey, on: settingDay(3, 1)),
          .threshold(sport: nil, threshold: "ftp", value: 250), at: .init(day(3, 1))),
        SettingWrite(
          SettingAddress(ftpKey, on: settingDay(6, 1)),
          .threshold(sport: nil, threshold: "ftp", value: 250), at: .init(day(6, 1))),
      ], through: nil)
    settings.record(
      [.threshold(.maxHeartRate, scope: .all, value: 190)], on: day(6, 1), at: day(6, 2))
    #expect(
      settings.ledger.unsent.map(\.address.key) == [
        .threshold(sport: nil, threshold: "max_heart_rate")
      ])
    #expect(settings.ledger.live.count == 3)
  }

  @Test func bringingSettingsOverKeepsASportsCopyOfTheDefaultAsItWasSaved() throws {
    let defaults = try freshDefaults()
    let entries: [[String: Any]] = try [
      (day(3, 1), [ZoneChange.threshold(.ftp, scope: .all, value: 200)]),
      (
        day(6, 1),
        [
          .listed(.running, true), .ownZones(.power, sport: .running, true),
          .threshold(.ftp, scope: .all, value: 250),
        ]
      ),
    ].map { date, changes in
      [
        "id": UUID().uuidString,
        "day": calendar.startOfDay(for: date).timeIntervalSinceReferenceDate,
        "changes": try JSONSerialization.jsonObject(with: JSONEncoder().encode(changes)),
      ]
    }
    defaults.set(
      try JSONSerialization.data(withJSONObject: [
        "history": ["entries": entries], "ftpTests": [Any](),
      ]), forKey: "riderSettings")
    let current = RiderSettings.load(from: defaults).history.current
    #expect(current.value(of: .ftp, in: .all) == 250)
    #expect(current.value(of: .ftp, in: .sport(.running)) == 200)
  }
}
