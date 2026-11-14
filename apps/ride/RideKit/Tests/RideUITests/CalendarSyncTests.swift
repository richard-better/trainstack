import Foundation
import RideData
import RideStrava
import Testing

@testable import RideBluetooth
@testable import RideUI

@MainActor
struct CalendarSyncTests {
  private final class Scratch {
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "CalendarSyncTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    var now = CalendarSyncTests.saturdayMorning
    deinit { try? FileManager.default.removeItem(at: directory) }
  }

  private struct Device {
    let calendar: AccountCalendar
    let sync: CalendarSync
    let directory: URL
    let server: FakeCalendarServer
    let scratch: Scratch

    static func launched(server: FakeCalendarServer, directory: URL, scratch: Scratch) -> Device {
      let calendar = AccountCalendar(directory: directory, now: { scratch.now })
      return Device(
        calendar: calendar,
        sync: CalendarSync(calendar: calendar, server: server, now: { scratch.now }),
        directory: directory, server: server, scratch: scratch)
    }

    func relaunched() -> Device {
      .launched(server: server, directory: directory, scratch: scratch)
    }

    func sync() async throws { try await sync.sync() }

    func syncIgnoringFailure() async {
      do { try await sync.sync() } catch {}
    }

    func names(on day: SettingDay) -> [String] {
      calendar.day(day)?.planned.map(\.title) ?? []
    }
  }

  nonisolated static let saturdayMorning = Date(timeIntervalSince1970: 1_794_650_400)
  nonisolated static let saturday = SettingDay("2026-11-14")!

  private let scratch = Scratch()

  private func device(_ name: String = "phone", server: FakeCalendarServer) -> Device {
    .launched(server: server, directory: scratch.directory.appending(path: name), scratch: scratch)
  }

  private func server(signedInAs account: String? = "ada") -> FakeCalendarServer {
    FakeCalendarServer(signedInAs: account, now: scratch.now)
  }

  private func advance(to date: Date, server: FakeCalendarServer) async {
    scratch.now = date
    await server.setClock(date)
  }

  static func workout(
    _ name: String, on day: SettingDay = saturday, position: Double = 0, minutes: Double = 60,
    sport: TrainStackWorkout.Sport = .cycling, id: String = UUID().uuidString.lowercased()
  ) throws -> PlannedItem {
    let workout = TrainStackWorkout(
      name: name, sport: sport,
      blocks: [
        .step(
          .init(
            duration: .seconds(minutes * 60), target: .power(unit: "ftp", level: .constant(0.7))))
      ])
    return PlannedItem(
      id: id, day: day, position: position,
      content: .workout(body: try JSONEncoder().encode(workout), notes: nil),
      planned: .init(seconds: minutes * 60, meters: nil, load: minutes * 0.8),
      updatedAt: saturdayMorning)
  }

  @Test func theDayIsSaturdayAtTheStartOfEachTest() {
    #expect(SettingDay(Self.saturdayMorning, in: TimeZone(identifier: "UTC")!) == Self.saturday)
  }

  @Test func keepsTheWeeksAroundTodayOnTheDeviceAndOffline() async throws {
    let server = server()
    await server.plan(try Self.workout("Threshold", position: 1))
    await server.plan(try Self.workout("Openers", position: 0))
    await server.plan(try Self.workout("Long ride", on: Self.saturday.adding(days: 1)))
    await server.plan(try Self.workout("Too far ahead", on: Self.saturday.adding(days: 60)))
    let phone = device(server: server)
    try await phone.sync()
    #expect(phone.calendar.today == Self.saturday)
    #expect(phone.names(on: Self.saturday) == ["Openers", "Threshold"])
    #expect(phone.names(on: Self.saturday.adding(days: 1)) == ["Long ride"])
    let window = try #require(phone.calendar.window)
    #expect(window.from == SettingDay("2026-10-12")!)
    #expect(window.through == SettingDay("2026-12-13")!)
    #expect(
      await server.calls.contains(.range(from: "2026-10-12", through: "2026-12-13", account: "ada"))
    )

    await server.goOffline()
    let relaunched = phone.relaunched()
    await relaunched.syncIgnoringFailure()
    #expect(relaunched.names(on: Self.saturday) == ["Openers", "Threshold"])
  }

  @Test func aChangeOnTheWebArrivesWithTheNextCheckAndAQuietCheckReadsNoRange() async throws {
    let server = server()
    let threshold = try Self.workout("Threshold")
    await server.plan(threshold)
    let phone = device(server: server)
    try await phone.sync()
    try await phone.sync()
    #expect(await server.rangeReads == 1)

    await server.moveOnTheWeb(threshold.id, to: Self.saturday.adding(days: 2))
    try await phone.sync()
    #expect(await server.rangeReads == 2)
    #expect(phone.names(on: Self.saturday).isEmpty)
    #expect(phone.names(on: Self.saturday.adding(days: 2)) == ["Threshold"])
  }

  @Test func asksForTheRangeAgainWhenTheScreenAsksEvenIfNothingWasPlanned() async throws {
    let server = server()
    let phone = device(server: server)
    try await phone.sync()
    await server.record(CalendarActivity(id: "ride", name: "Ride from Strava"), on: Self.saturday)
    try await phone.sync()
    #expect(phone.calendar.day(Self.saturday)?.activities.isEmpty == true)
    phone.sync.syncSoon()
    try await phone.sync()
    #expect(phone.calendar.day(Self.saturday)?.activities.map(\.id) == ["ride"])
  }

  @Test func readsTheRangeAgainAfterAWhileAndSoonerWhileAnAnalysisIsDue() async throws {
    let server = server()
    let phone = device(server: server)
    try await phone.sync()
    await advance(to: Self.saturdayMorning + 60, server: server)
    try await phone.sync()
    #expect(await server.rangeReads == 1)
    await advance(to: Self.saturdayMorning + CalendarSync.rangeKeptFresh, server: server)
    try await phone.sync()
    #expect(await server.rangeReads == 2)

    await server.setAnalysesDue(1)
    phone.sync.syncSoon()
    try await phone.sync()
    #expect(await server.rangeReads == 3)
    await advance(
      to: Self.saturdayMorning + CalendarSync.rangeKeptFresh + CalendarSync.analysisChecked,
      server: server)
    try await phone.sync()
    #expect(await server.rangeReads == 4)
  }

  @Test func aPlannedWorkoutDeletedOnTheWebWhileOfflineGoesWhenBack() async throws {
    let server = server()
    let threshold = try Self.workout("Threshold")
    await server.plan(threshold)
    let phone = device(server: server)
    try await phone.sync()
    await server.goOffline()
    await server.deleteOnTheWeb(threshold.id)
    await phone.syncIgnoringFailure()
    #expect(phone.names(on: Self.saturday) == ["Threshold"])
    await server.goOffline(false)
    try await phone.sync()
    #expect(phone.names(on: Self.saturday).isEmpty)
    #expect(phone.calendar[threshold.id] == nil)
  }

  @Test func atMidnightTodayMovesOnOfflineAndAnUndoneWorkoutIsMissed() async throws {
    let server = server()
    let threshold = try Self.workout("Threshold")
    await server.plan(threshold)
    await server.plan(try Self.workout("Long ride", on: Self.saturday.adding(days: 1)))
    let phone = device(server: server)
    try await phone.sync()
    #expect(phone.calendar[threshold.id]?.state == .planned)

    await server.goOffline()
    scratch.now = Self.saturdayMorning + 14 * 3600
    phone.sync.checkSoon()
    #expect(phone.calendar.today == Self.saturday.adding(days: 1))
    #expect(phone.calendar[threshold.id]?.state == .missed)
    #expect(phone.names(on: Self.saturday.adding(days: 1)) == ["Long ride"])

    await server.goOffline(false)
    await server.setClock(scratch.now)
    try await phone.sync()
    let window = try #require(phone.calendar.window)
    #expect(window == CalendarWindow(around: Self.saturday.adding(days: 1)))
    #expect(phone.calendar.state?.range?.today == Self.saturday.adding(days: 1))
  }

  @Test func todayIsTheAthletesDayWhereverTheDeviceIs() async throws {
    let server = server()
    let lateEvening = Self.saturdayMorning + 13 * 3600 + 30 * 60
    await advance(to: lateEvening, server: server)
    await server.setTimeZone(TimeZone(identifier: "Europe/Budapest")!)
    let phone = device(server: server)
    try await phone.sync()
    #expect(phone.calendar.today == Self.saturday.adding(days: 1))

    await server.setTimeZone(TimeZone(identifier: "America/New_York")!)
    phone.sync.syncSoon()
    try await phone.sync()
    #expect(phone.calendar.today == Self.saturday)
  }

  @Test func signingOutHidesTheCalendarAndAnotherAccountSeesOnlyItsOwn() async throws {
    let server = server()
    await server.plan(try Self.workout("Ada's ride"))
    await server.plan(try Self.workout("Grace's run", sport: .running), for: "grace")
    let phone = device(server: server)
    try await phone.sync()
    #expect(phone.names(on: Self.saturday) == ["Ada's ride"])

    await server.signIn(as: nil)
    await #expect(throws: StravaError.signedOut) { try await phone.sync() }
    #expect(phone.calendar.day(Self.saturday) == nil)

    await server.signIn(as: "grace")
    phone.sync.accountChanged()
    #expect(phone.calendar.day(Self.saturday) == nil)
    try await phone.sync()
    #expect(phone.names(on: Self.saturday) == ["Grace's run"])

    await server.signIn(as: "ada")
    await server.goOffline()
    await phone.syncIgnoringFailure()
    #expect(phone.names(on: Self.saturday) == ["Ada's ride"])
  }

  @Test func switchingStraightToAnotherAccountHidesThePreviousCalendarAtOnce() async throws {
    let server = server()
    await server.plan(try Self.workout("Ada's ride"))
    let phone = device(server: server)
    try await phone.sync()
    #expect(phone.names(on: Self.saturday) == ["Ada's ride"])
    await server.signIn(as: "grace")
    phone.sync.accountChanged()
    #expect(phone.calendar.day(Self.saturday) == nil)
  }

  @Test func aDeletedAccountLeavesNoCalendarBehind() async throws {
    let server = server()
    await server.plan(try Self.workout("Threshold"))
    let phone = device(server: server)
    try await phone.sync()
    phone.sync.accountDeleted("ada")
    #expect(phone.calendar.day(Self.saturday) == nil)
    await server.goOffline()
    await phone.relaunched().syncIgnoringFailure()
    #expect(phone.relaunched().calendar.state == nil)
    let files = try? FileManager.default.contentsOfDirectory(atPath: phone.directory.path)
    #expect(files?.isEmpty ?? true)
  }

  @Test func aRideKeepsThePlannedCopyItStartedWithWhenTheWebChangesIt() async throws {
    let server = server()
    let threshold = try Self.workout("Threshold", minutes: 10)
    await server.plan(threshold)
    let phone = device(server: server)
    try await phone.sync()
    let defaults = try #require(UserDefaults(suiteName: "CalendarSyncTests.\(UUID().uuidString)"))
    let launcher = RideLauncher(
      simulated: true,
      devices: BluetoothDevices(transport: CyclingTestTransport(), defaults: defaults),
      journalDirectory: scratch.directory.appending(path: "journal"))
    let planned = try #require(phone.calendar[threshold.id]?.rideability?.planned)
    launcher.start(planned, ftp: 200, heartRateZones: nil, riderWeight: 75)
    defer { launcher.end() }
    await server.plan(try Self.workout("Threshold", minutes: 40, id: threshold.id))
    try await phone.sync()
    #expect(phone.calendar[threshold.id]?.planned?.seconds == TimeInterval(40 * 60))
    #expect(launcher.ride?.workout == planned)
    #expect(launcher.ride?.session.duration == TimeInterval(10 * 60))
  }
}
