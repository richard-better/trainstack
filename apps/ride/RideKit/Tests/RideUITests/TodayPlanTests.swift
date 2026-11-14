import Foundation
import RideData
import RideStrava
import Testing

@testable import RideUI

@MainActor
struct TodayPlanTests {
  private final class Scratch {
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "TodayPlanTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    deinit { try? FileManager.default.removeItem(at: directory) }
  }

  private let scratch = Scratch()
  private let saturday = CalendarSyncTests.saturday

  private func plan(_ items: [PlannedItem]) async throws -> TodayPlan? {
    let server = FakeCalendarServer(now: CalendarSyncTests.saturdayMorning)
    for item in items { await server.plan(item) }
    let calendar = AccountCalendar(
      directory: scratch.directory, now: { CalendarSyncTests.saturdayMorning })
    try await CalendarSync(
      calendar: calendar, server: server, now: { CalendarSyncTests.saturdayMorning }
    ).sync()
    return TodayPlan(calendar: calendar)
  }

  private func item(_ content: PlannedItem.Content, position: Double = 0) -> PlannedItem {
    PlannedItem(
      id: UUID().uuidString, day: saturday, position: position, content: content,
      updatedAt: CalendarSyncTests.saturdayMorning)
  }

  @Test func showsNothingUntilTheCalendarHasBeenRead() {
    #expect(TodayPlan(calendar: AccountCalendar(directory: scratch.directory)) == nil)
  }

  @Test func saysWhatIsLeftToDoAndStartsTheFirstRideableWorkout() async throws {
    let run = try CalendarSyncTests.workout("Easy run", position: 0, sport: .running)
    let ride = try CalendarSyncTests.workout("Threshold", position: 1)
    let plan = try #require(
      try await plan([run, ride, item(.note(title: "Travel", notes: nil), position: 2)]))
    #expect(plan.items.map(\.title) == ["Easy run", "Threshold", "Travel"])
    #expect(plan.headline == "2 workouts planned")
    #expect(plan.firstToStart?.id == ride.id)
    #expect(plan.items[0].whyItCannotBeRidden?.contains("running") == true)
  }

  @Test func aRestDayAndAnEmptyDayReadAsWhatTheyAre() async throws {
    #expect(try await plan([item(.rest(notes: "Legs up"))])?.headline == "Rest day")
    let empty = try #require(try await plan([]))
    #expect(empty.headline == "Nothing planned")
    #expect(empty.upcoming.count == TodayPlan.daysAhead)
    #expect(empty.upcoming.first?.day == saturday.adding(days: 1))
  }

  @Test func theDaysAheadHoldWhatIsPlannedOnThem() async throws {
    let plan = try #require(
      try await plan([try CalendarSyncTests.workout("Long ride", on: saturday.adding(days: 1))]))
    #expect(plan.upcoming.first?.planned.map(\.title) == ["Long ride"])
    #expect(plan.headline == "Nothing planned")
  }

  @Test func daysTheDeviceNeverReadAreNotShownAsEmpty() async throws {
    let server = FakeCalendarServer(now: CalendarSyncTests.saturdayMorning)
    let scratch = scratch
    var now = CalendarSyncTests.saturdayMorning
    let calendar = AccountCalendar(directory: scratch.directory, now: { now })
    try await CalendarSync(calendar: calendar, server: server, now: { now }).sync()
    now += 27 * 86400
    calendar.refreshToday()
    let lastWeek = try #require(TodayPlan(calendar: calendar))
    #expect(lastWeek.upcoming.map(\.day) == [SettingDay("2026-12-12")!, SettingDay("2026-12-13")!])
    now += 7 * 86400
    calendar.refreshToday()
    #expect(TodayPlan(calendar: calendar) == nil)
  }

  @Test func aSkippedWorkoutIsNotTheOneTodayStarts() async throws {
    var skipped = try CalendarSyncTests.workout("Threshold", position: 0)
    skipped.skipped = .init(reason: nil)
    let ride = try CalendarSyncTests.workout("Endurance", position: 1)
    let plan = try #require(try await plan([skipped, ride]))
    #expect(plan.items.first?.state == .skipped)
    #expect(plan.firstToStart?.id == ride.id)
  }
}
