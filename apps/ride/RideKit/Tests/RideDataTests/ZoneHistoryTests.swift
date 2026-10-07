import Foundation
import Testing

@testable import RideData

struct ZoneHistoryTests {
  private let calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
  }()

  private func day(_ month: Int, _ day: Int) -> Date {
    calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: 12))!
  }

  private func ftp(_ value: Int?, _ scope: ZoneScope = .all) -> ZoneChange {
    .threshold(.ftp, scope: scope, value: value)
  }

  private func ftp(on date: Date, in history: ZoneHistory, _ scope: ZoneScope = .all) -> Int? {
    history.profile(on: date, calendar: calendar).value(of: .ftp, in: scope)
  }

  @Test func usesTheZonesInEffectOnEachDay() {
    var history = ZoneHistory()
    history.record([ftp(200)], on: day(3, 1), calendar: calendar)
    history.record([ftp(220)], on: day(6, 1), calendar: calendar)
    #expect(ftp(on: day(5, 31), in: history) == 200)
    #expect(ftp(on: day(6, 1), in: history) == 220)
    #expect(ftp(on: day(9, 1), in: history) == 220)
    // Before the first change, the earliest zones apply.
    #expect(ftp(on: day(1, 1), in: history) == 200)
    #expect(history.current.value(of: .ftp, in: .all) == 220)
  }

  @Test func groupsChangesOnTheSameDayAndKeepsTheLast() {
    var history = ZoneHistory()
    history.record([ftp(200)], on: day(3, 1), calendar: calendar)
    history.record([ftp(210)], on: day(6, 1), calendar: calendar)
    history.record([ftp(215)], on: day(6, 1).addingTimeInterval(3600), calendar: calendar)
    #expect(history.entries.count == 2)
    #expect(history.entries[1].changes == [ftp(215)])
  }

  @Test func dropsChangesThatUndoThemselves() {
    var history = ZoneHistory()
    history.record([ftp(200)], on: day(3, 1), calendar: calendar)
    history.record([ftp(210)], on: day(6, 1), calendar: calendar)
    history.record([ftp(200)], on: day(6, 1), calendar: calendar)
    #expect(history.entries.count == 1)
  }

  @Test func carriesAPastChangeForwardUntilTheNextOne() {
    var history = ZoneHistory()
    history.record([ftp(200)], on: day(3, 1), calendar: calendar)
    history.record(
      [.threshold(.maxHeartRate, scope: .all, value: 190)], on: day(9, 1),
      calendar: calendar)
    history.record([ftp(230)], on: day(8, 1), calendar: calendar)
    #expect(ftp(on: day(7, 31), in: history) == 200)
    #expect(ftp(on: day(9, 2), in: history) == 230)
    #expect(history.entries.map(\.day) == [3, 8, 9].map { calendar.startOfDay(for: day($0, 1)) })
  }

  @Test func movesAndRemovesEntries() throws {
    var history = ZoneHistory()
    history.record([ftp(200)], on: day(3, 1), calendar: calendar)
    history.record([ftp(220)], on: day(6, 1), calendar: calendar)
    let june = try #require(history.entries.last?.id)
    history.move(june, to: day(4, 1), calendar: calendar)
    #expect(ftp(on: day(4, 15), in: history) == 220)
    history.remove(try #require(history.entries.last?.id))
    #expect(ftp(on: day(9, 1), in: history) == 200)
  }

  @Test func letsASportKeepItsOwnZones() {
    var history = ZoneHistory()
    history.record([ftp(250), .listed(.running, true)], on: day(3, 1), calendar: calendar)
    let running = ZoneScope.sport(.running)
    var profile = history.current
    #expect(profile.listedSports == [.running])
    #expect(profile.usesDefault(.power, in: .running))
    #expect(profile.value(of: .ftp, in: running) == 250)
    // Running starts with pace zones that need a threshold pace.
    #expect(profile.settings(for: .pace, in: running)?.missingThresholds == [.thresholdPace])
    #expect(profile.settings(for: .pace, in: .all) == nil)

    // A change to a sport that uses Default does nothing.
    history.record([ftp(300, running)], on: day(3, 2), calendar: calendar)
    #expect(history.entries.count == 1)

    history.record(
      [.ownZones(.power, sport: .running, true), ftp(300, running)], on: day(4, 1),
      calendar: calendar)
    profile = history.current
    #expect(!profile.usesDefault(.power, in: .running))
    #expect(profile.value(of: .ftp, in: running) == 300)
    #expect(profile.value(of: .ftp, in: .all) == 250)
    #expect(profile.zones(for: .power, in: .running)?.limits.first == 167)
    #expect(profile.zones(for: .power, in: .cycling)?.limits.first == 139)
    #expect(profile.zones(for: .power, in: nil)?.limits.first == 139)

    history.record([.listed(.running, false)], on: day(5, 1), calendar: calendar)
    #expect(history.current.listedSports.isEmpty)
    #expect(history.current.value(of: .ftp, in: running) == 250)
  }

  @Test func roundTripsThroughCoding() throws {
    var history = ZoneHistory()
    history.record(
      [
        ftp(250), .listed(.swimming, true),
        .threshold(.thresholdPace, scope: .sport(.swimming), value: 95),
        .choice(.heartRate, scope: .all, ZoneChoice(model: .karvonen, customLimits: [1, 2, 3, 4])),
      ], on: day(3, 1), calendar: calendar)
    let decoded = try JSONDecoder().decode(
      ZoneHistory.self, from: JSONEncoder().encode(history))
    #expect(decoded == history)
  }
}
