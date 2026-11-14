import Foundation
import RideData
import RideStrava
import Testing

@testable import RideBluetooth
@testable import RideUI

@MainActor
struct CalendarWritesTests {
  private final class Scratch {
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "CalendarWritesTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    var now = CalendarSyncTests.saturdayMorning
    deinit { try? FileManager.default.removeItem(at: directory) }
  }

  private let scratch = Scratch()
  private let saturday = CalendarSyncTests.saturday
  private let morning = CalendarSyncTests.saturdayMorning

  private func phone(_ server: FakeCalendarServer) -> (AccountCalendar, CalendarSync) {
    let scratch = scratch
    let calendar = AccountCalendar(
      directory: scratch.directory.appending(path: "phone"), now: { scratch.now })
    return (calendar, CalendarSync(calendar: calendar, server: server, now: { scratch.now }))
  }

  private func advance(_ seconds: TimeInterval, _ server: FakeCalendarServer) async {
    scratch.now += seconds
    await server.setClock(scratch.now)
  }

  private func syncIgnoringFailure(_ sync: CalendarSync) async {
    do { try await sync.sync() } catch {}
  }

  @Test func aSkipMadeOfflineShowsAtOnceAndReachesTheServerWithItsReason() async throws {
    let server = FakeCalendarServer(now: morning)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    let (calendar, sync) = phone(server)
    try await sync.sync()
    await server.goOffline()
    await advance(60, server)
    calendar.skip(threshold.id, reason: "  Work ran late ")
    #expect(calendar[threshold.id]?.state == .skipped)
    #expect(calendar[threshold.id]?.skipped?.reason == "Work ran late")
    await syncIgnoringFailure(sync)
    #expect(calendar.state?.writes.count == 1)

    await server.goOffline(false)
    try await sync.sync()
    #expect(calendar.state?.writes.isEmpty == true)
    #expect(await server.item(threshold.id)?.skipped?.reason == "Work ran late")
    #expect(calendar[threshold.id]?.state == .skipped)

    await advance(60, server)
    calendar.unskip(threshold.id)
    try await sync.sync()
    #expect(await server.item(threshold.id)?.skipped == nil)
    #expect(calendar[threshold.id]?.state == .planned)
  }

  @Test func aMoveShowsOnItsNewDayAtOnceAndALaterMoveOnTheWebWins() async throws {
    let server = FakeCalendarServer(now: morning)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    let (calendar, sync) = phone(server)
    try await sync.sync()
    await server.goOffline()
    await advance(60, server)
    calendar.move(threshold.id, to: saturday.adding(days: 2))
    #expect(calendar.day(saturday)?.planned.isEmpty == true)
    #expect(calendar.day(saturday.adding(days: 2))?.planned.map(\.id) == [threshold.id])

    await advance(60, server)
    await server.moveOnTheWeb(threshold.id, to: saturday.adding(days: 3))
    await server.goOffline(false)
    try await sync.sync()
    #expect(calendar.state?.writes.isEmpty == true)
    #expect(calendar[threshold.id]?.day == saturday.adding(days: 3))
  }

  @Test func anEditToAPlannedWorkoutDeletedOnTheWebWhileOfflineIsDropped() async throws {
    let server = FakeCalendarServer(now: morning)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    let (calendar, sync) = phone(server)
    try await sync.sync()
    await server.goOffline()
    await advance(60, server)
    calendar.skip(threshold.id, reason: nil)
    calendar.move(threshold.id, to: saturday.adding(days: 1))
    await server.deleteOnTheWeb(threshold.id)
    await server.goOffline(false)
    try await sync.sync()
    #expect(calendar.state?.writes.isEmpty == true)
    #expect(calendar[threshold.id] == nil)
    #expect(await server.writes.count == 1)
  }

  @Test func anEditStampedAheadOfTheServersClockWaitsAndIsSentLater() async throws {
    let server = FakeCalendarServer(now: morning)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    let (calendar, sync) = phone(server)
    try await sync.sync()
    scratch.now = morning + 120
    calendar.skip(threshold.id, reason: nil)
    try await sync.sync()
    #expect(calendar.state?.writes.count == 1)
    #expect(calendar[threshold.id]?.state == .skipped)
    await server.setClock(morning + 180)
    try await sync.sync()
    #expect(calendar.state?.writes.isEmpty == true)
    #expect(await server.item(threshold.id)?.skipped != nil)
  }

  @Test func unpairingAWrongMatchTakesThemApartForGood() async throws {
    let server = FakeCalendarServer(now: morning)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    await server.record(
      CalendarActivity(id: "commute", name: "Commute", plannedId: threshold.id), on: saturday)
    let (calendar, sync) = phone(server)
    try await sync.sync()
    #expect(calendar[threshold.id]?.state == .completed)
    await advance(60, server)
    calendar.unpair(threshold.id)
    #expect(calendar[threshold.id]?.pairing == nil)
    #expect(calendar[threshold.id]?.state == .planned)
    try await sync.sync()
    #expect(calendar[threshold.id]?.pairing == nil)
    #expect(
      calendar.day(saturday).map(CalendarDayPairs.init)?.unplanned.map(\.id) == ["commute"])
  }

  @Test func aRideStartedFromThePlanPairsWithItOnceItsRecordingIsOnTheServer() async throws {
    let server = FakeCalendarServer(now: morning)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    let (calendar, sync) = phone(server)
    try await sync.sync()
    await advance(3600, server)
    calendar.rode(
      .init(account: "ada", plannedID: threshold.id), as: "ride", startedAt: morning,
      endedAt: scratch.now)
    try await sync.sync()
    #expect(calendar.state?.ridesToPair.count == 1)

    await server.record(CalendarActivity(id: "ride", name: "Threshold"), on: saturday)
    try await sync.sync()
    #expect(calendar.state?.ridesToPair.isEmpty == true)
    #expect(calendar[threshold.id]?.pairing == .init(activityId: "ride", by: .athlete))
    #expect(calendar[threshold.id]?.state == .completed)
  }

  @Test func aMoveOnTheWebDuringTheRideIsUndoneByTheRideThatFulfilledIt() async throws {
    let server = FakeCalendarServer(now: morning)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    let (calendar, sync) = phone(server)
    try await sync.sync()
    await advance(600, server)
    await server.moveOnTheWeb(threshold.id, to: saturday.adding(days: 1))
    await advance(3000, server)
    calendar.rode(
      .init(account: "ada", plannedID: threshold.id), as: "ride", startedAt: morning,
      endedAt: scratch.now)
    await server.record(CalendarActivity(id: "ride", name: "Threshold"), on: saturday)
    try await sync.sync()
    #expect(await server.item(threshold.id)?.day == saturday)
    #expect(calendar[threshold.id]?.day == saturday)
    #expect(calendar[threshold.id]?.pairing == .init(activityId: "ride", by: .athlete))
  }

  @Test func aMoveOnTheWebAfterTheRideEndedStandsAndTheRideStaysUnplanned() async throws {
    let server = FakeCalendarServer(now: morning)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    let (calendar, sync) = phone(server)
    try await sync.sync()
    await advance(3600, server)
    calendar.rode(
      .init(account: "ada", plannedID: threshold.id), as: "ride", startedAt: morning,
      endedAt: scratch.now)
    await server.record(CalendarActivity(id: "ride", name: "Threshold"), on: saturday)
    await advance(60, server)
    await server.moveOnTheWeb(threshold.id, to: saturday.adding(days: 1))
    try await sync.sync()
    #expect(calendar.state?.ridesToPair.isEmpty == true)
    #expect(calendar[threshold.id]?.day == saturday.adding(days: 1))
    #expect(calendar[threshold.id]?.pairing == nil)
  }

  @Test func aRideStartedFromAPlannedWorkoutDeletedSinceStaysUnplanned() async throws {
    let server = FakeCalendarServer(now: morning)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    let (calendar, sync) = phone(server)
    try await sync.sync()
    await server.deleteOnTheWeb(threshold.id)
    await advance(3600, server)
    calendar.rode(
      .init(account: "ada", plannedID: threshold.id), as: "ride", startedAt: morning,
      endedAt: scratch.now)
    await server.record(CalendarActivity(id: "ride", name: "Threshold"), on: saturday)
    try await sync.sync()
    #expect(calendar.state?.ridesToPair.isEmpty == true)
    #expect(calendar.day(saturday)?.activities.map(\.id) == ["ride"])
  }

  @Test func editsMadeAsOneAthleteNeverReachAnother() async throws {
    let server = FakeCalendarServer(now: morning)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    await server.plan(threshold, for: "grace")
    let (calendar, sync) = phone(server)
    try await sync.sync()
    await server.goOffline()
    await advance(60, server)
    calendar.skip(threshold.id, reason: nil)
    await server.goOffline(false)
    await server.signIn(as: "grace")
    sync.accountChanged()
    try await sync.sync()
    #expect(await server.writes.isEmpty)
    #expect(calendar[threshold.id]?.state == .planned)

    await server.signIn(as: "ada")
    sync.accountChanged()
    try await sync.sync()
    #expect(await server.item(threshold.id, of: "ada")?.skipped != nil)
    #expect(await server.item(threshold.id, of: "grace")?.skipped == nil)
  }

  @Test func aSavedRideStartedFromThePlanSaysWhichPlannedWorkoutItFulfilled() throws {
    let defaults = try #require(UserDefaults(suiteName: "CalendarWritesTests.\(UUID().uuidString)"))
    let launcher = RideLauncher(
      simulated: true,
      devices: BluetoothDevices(transport: CyclingTestTransport(), defaults: defaults),
      journalDirectory: scratch.directory.appending(path: "journal"))
    let library = RideLibrary(directory: scratch.directory.appending(path: "rides"))
    var saved: [(String, Ride.ID)] = []
    launcher.onPlannedRideSaved = { planned, rideID, _, _ in
      saved.append((planned.plannedID, rideID))
    }
    let planned = try #require(try CalendarSyncTests.workout("Threshold").playable)

    launcher.start(
      planned, ftp: 200, heartRateZones: nil, riderWeight: 75,
      planned: PlannedRide(account: "ada", plannedID: "planned"))
    for _ in 0..<5 { launcher.ride?.tick(seconds: 1) }
    launcher.end(saveTo: library)
    #expect(saved.map(\.0) == ["planned"])
    #expect(saved.map(\.1) == library.rides.map(\.id))

    launcher.start(planned, ftp: 200, heartRateZones: nil, riderWeight: 75)
    for _ in 0..<5 { launcher.ride?.tick(seconds: 1) }
    launcher.end(saveTo: library)
    #expect(saved.count == 1)
  }

  @Test func aRideSavedAfterSigningOutStillPairsInTheAccountItWasPlannedIn() async throws {
    let server = FakeCalendarServer(now: morning)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    let (calendar, sync) = phone(server)
    try await sync.sync()
    let item = try #require(calendar[threshold.id])
    let planned = try #require(calendar.ride(of: item))
    await server.signIn(as: nil)
    await #expect(throws: StravaError.signedOut) { try await sync.sync() }
    await advance(3600, server)
    calendar.rode(planned, as: "ride", startedAt: morning, endedAt: scratch.now)
    await server.record(CalendarActivity(id: "ride", name: "Threshold"), on: saturday)

    await server.signIn(as: "ada")
    sync.accountChanged()
    try await sync.sync()
    #expect(calendar[threshold.id]?.pairing == .init(activityId: "ride", by: .athlete))
  }

  @Test func anEditAfterARelaunchIsStampedAfterEveryEarlierOne() async throws {
    let server = FakeCalendarServer(now: morning)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    let (calendar, sync) = phone(server)
    try await sync.sync()
    scratch.now = morning + 3600
    calendar.skip(threshold.id, reason: nil)
    scratch.now = morning + 60
    let (relaunched, again) = phone(server)
    try await again.sync()
    relaunched.unskip(threshold.id)
    let stamps = relaunched.state?.writes.map { write -> Date in
      switch write {
      case .skip(_, _, let at), .unskip(_, let at), .move(_, _, _, let at), .pair(_, _, let at),
        .unpair(_, _, let at):
        at
      }
    }
    #expect(stamps?.count == 2)
    #expect(stamps.map { $0[1] > $0[0] } == true)
    _ = calendar
  }

  @Test func anUnpairAfterTheRideShowsAtOnceWhileThePairingWaits() async throws {
    let server = FakeCalendarServer(now: morning)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    await server.record(CalendarActivity(id: "ride", name: "Threshold"), on: saturday)
    let (calendar, sync) = phone(server)
    try await sync.sync()
    await server.goOffline()
    await advance(60, server)
    calendar.rode(
      .init(account: "ada", plannedID: threshold.id), as: "ride", startedAt: morning,
      endedAt: scratch.now)
    #expect(calendar[threshold.id]?.pairing?.by == .athlete)
    await advance(60, server)
    calendar.unpair(threshold.id)
    #expect(calendar[threshold.id]?.pairing == nil)
  }

  @Test func anAcceptedEditStaysWhenTheNextReadFailsAndAfterARelaunch() async throws {
    let server = FakeCalendarServer(now: morning)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    let (calendar, sync) = phone(server)
    try await sync.sync()
    await advance(60, server)
    calendar.skip(threshold.id, reason: "Travel")
    await server.failNextRange()
    await syncIgnoringFailure(sync)
    #expect(calendar.state?.writes.isEmpty == true)
    #expect(calendar[threshold.id]?.skipped?.reason == "Travel")
    await server.goOffline()
    let (relaunched, again) = phone(server)
    await syncIgnoringFailure(again)
    #expect(relaunched[threshold.id]?.state == .skipped)
  }

  @Test func aRideIsOnTheAthletesDayAsTheServerDatesIt() async throws {
    let server = FakeCalendarServer(now: morning)
    await server.setTimeZone(TimeZone(identifier: "America/New_York")!)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    let (calendar, sync) = phone(server)
    try await sync.sync()
    let lateEvening = morning + 13.5 * 3600
    calendar.rode(
      .init(account: "ada", plannedID: threshold.id), as: "ride", startedAt: lateEvening,
      endedAt: lateEvening + 3600)
    #expect(calendar.state?.ridesToPair.first?.rideDay == saturday)
  }

  @Test func aRidesPairingStaysWhenTheNextReadFailsAndAfterARelaunch() async throws {
    let server = FakeCalendarServer(now: morning)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    await server.record(CalendarActivity(id: "ride", name: "Threshold"), on: saturday)
    let (calendar, sync) = phone(server)
    try await sync.sync()
    await advance(600, server)
    await server.moveOnTheWeb(threshold.id, to: saturday.adding(days: 1))
    await advance(3000, server)
    calendar.rode(
      .init(account: "ada", plannedID: threshold.id), as: "ride", startedAt: morning,
      endedAt: scratch.now)
    await server.failNextRange()
    await syncIgnoringFailure(sync)
    #expect(calendar.state?.ridesToPair.isEmpty == true)
    #expect(calendar[threshold.id]?.day == saturday)
    #expect(calendar[threshold.id]?.pairing == .init(activityId: "ride", by: .athlete))
    await server.goOffline()
    let (relaunched, again) = phone(server)
    await syncIgnoringFailure(again)
    #expect(relaunched[threshold.id]?.day == saturday)
    #expect(relaunched[threshold.id]?.state == .completed)
  }

  @Test func aPairingAnsweredAfterSwitchingAccountsStaysOutOfTheNewAccount() async throws {
    let server = FakeCalendarServer(now: morning)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    await server.record(CalendarActivity(id: "ride", name: "Threshold"), on: saturday)
    let (calendar, sync) = phone(server)
    try await sync.sync()
    await advance(3600, server)
    calendar.rode(
      .init(account: "ada", plannedID: threshold.id), as: "ride", startedAt: morning,
      endedAt: scratch.now)
    await server.holdWrites()
    let pass = Task { try await sync.sync() }
    while !(await server.isHoldingAWrite) { await Task.yield() }
    await server.signIn(as: "grace")
    sync.accountChanged()
    let (_, graceSync) = phoneSync(calendar, server)
    try await graceSync.sync()
    await server.releaseWrites()
    _ = try? await pass.value
    #expect(calendar.account == "grace")
    #expect(calendar[threshold.id] == nil)
  }

  private func phoneSync(_ calendar: AccountCalendar, _ server: FakeCalendarServer)
    -> (AccountCalendar, CalendarSync)
  {
    let scratch = scratch
    return (calendar, CalendarSync(calendar: calendar, server: server, now: { scratch.now }))
  }

  @Test func aMoveToAnotherWeekMovesItsPlannedNumbersWithItAtOnce() throws {
    let numbers = PlannedItem.Numbers(seconds: 3600, meters: nil, load: 50)
    var item = try CalendarSyncTests.workout("Threshold")
    item.planned = numbers
    let planned = CalendarRange.PlannedAgainstCompleted(
      planned: .init(seconds: 3600, meters: 0, load: 50))
    let tuesday = saturday.adding(days: 3)
    let range = CalendarRange(
      today: saturday,
      days: [
        .init(day: saturday, planned: [item], totals: planned), .init(day: tuesday),
      ],
      weeks: [.init(start: saturday.monday, totals: planned), .init(start: tuesday.monday)])
    let moved = range.applying(
      [.move(id: item.id, day: tuesday, position: 0, updatedAt: morning)], rides: [],
      today: saturday)
    #expect(moved.weeks.map(\.totals.planned.seconds) == [0, 3600])
    #expect(moved.weeks.map(\.totals.planned.load) == [0, 50])
    #expect(moved.days.map(\.totals.planned.seconds) == [0, 3600])

    var stored = item
    stored.day = tuesday
    var replaced = range
    replaced.replace(with: stored)
    #expect(replaced.weeks.map(\.totals.planned.load) == [0, 50])
  }

  @Test func aCalendarKeptBeforeEditsExistedStillReads() throws {
    let kept = """
      {"account":"ada","plannedCursor":"4","range":{"today":"2026-11-14","analysesDue":0,\
      "weeks":[],"days":[{"day":"2026-11-14","planned":[],"activities":[],"totals":\
      {"planned":{"seconds":0,"meters":0,"load":0},"completed":{"seconds":0,"meters":0,"load":0}}}]}}
      """
    let state = try JSONDecoder().decode(AccountCalendarState.self, from: Data(kept.utf8))
    #expect(state.range?.days.map(\.day) == [saturday])
    #expect(state.plannedCursor == "4")
    #expect(state.writes.isEmpty)
    #expect(state.ridesToPair.isEmpty)
  }

  @Test func theFakeServerAnswersWithTheWinningPairingChoice() async throws {
    let server = FakeCalendarServer(now: morning + 600)
    let threshold = try CalendarSyncTests.workout("Threshold")
    await server.plan(threshold)
    await server.record(CalendarActivity(id: "ride"), on: saturday)
    let ada = ActivityAccount(id: "ada", token: "token-ada")
    _ = try await server.send(
      .unpair(id: threshold.id, activityId: "ride", updatedAt: morning + 300), for: ada)
    let olderPair = try await server.send(
      .pair(id: threshold.id, activityId: "ride", updatedAt: morning + 100), for: ada)
    #expect(olderPair == .stored(try #require(await server.item(threshold.id))))
    #expect(await server.item(threshold.id)?.pairing == nil)
    _ = try await server.send(
      .pair(id: threshold.id, activityId: "ride", updatedAt: morning + 500), for: ada)
    _ = try await server.send(
      .unpair(id: threshold.id, activityId: "ride", updatedAt: morning + 400), for: ada)
    #expect(await server.item(threshold.id)?.pairing?.by == .athlete)
  }
}
