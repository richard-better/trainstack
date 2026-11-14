import Foundation
import RideData
import RideStrava
import Testing

@testable import RideUI

@MainActor
struct CalendarDisplayTests {
  private let saturday = CalendarSyncTests.saturday

  private func paired(
    _ compliance: PlannedCompliance?, by maker: PlannedItem.Pairing.Maker = .auto,
    activity: String = "ride", workout: TrainStackWorkout? = nil
  ) throws -> PlannedItem {
    var item = try CalendarSyncTests.workout("Threshold")
    if let workout { item.content = .workout(body: try JSONEncoder().encode(workout), notes: nil) }
    item.pairing = .init(activityId: activity, by: maker)
    item.state = .completed
    item.compliance = compliance
    return item
  }

  @Test func saysWhichPartPulledTheScoreDownInTheWebsWords() throws {
    let item = try paired(
      PlannedCompliance(
        score: 76, rating: .partly,
        parts: .init(
          duration: .init(planned: 3600, done: 4200, ratio: 4200.0 / 3600, score: 1),
          load: .init(planned: 73, done: 81, ratio: 81.0 / 73, score: 1),
          intervals: .init(
            secondsWithData: 3600, secondsInTarget: 979, share: 0.2719, score: 0.2719)
        )))
    let words = try #require(ComplianceWords(item))
    #expect(words.score == 76)
    #expect(words.label == "Partly")
    #expect(words.why == "Intervals pulled it down: 27% of the time in target.")
    #expect(words.parts.map(\.key) == [.duration, .load, .intervals])
    #expect(words.parts[0].verdict == "17% over, within 20%")
    #expect(words.parts[0].done == "1h 10m")
    #expect(words.unscored.isEmpty)
  }

  @Test func aTimeThatFellShortIsNamedWithItsNumbers() throws {
    let item = try paired(
      PlannedCompliance(
        score: 40, rating: .offTarget,
        parts: .init(duration: .init(planned: 3600, done: 1200, ratio: 1.0 / 3, score: 0))))
    let words = try #require(ComplianceWords(item))
    #expect(words.why == "Time pulled it down: 20m against 1h 00m planned, 67% under.")
    #expect(
      words.unscored.contains(
        "Load is not scored: the plan or the activity has no load, which needs your thresholds."))
  }

  @Test func aLapButtonWorkoutIsScoredOnItsIntervalsAlone() throws {
    let workout = TrainStackWorkout(
      name: "Climbs", sport: .cycling,
      blocks: [
        .step(
          .init(
            duration: .untilLap(expected: .seconds(180)),
            target: .power(unit: "ftp", level: .constant(0.95))))
      ])
    let item = try paired(
      PlannedCompliance(score: nil, rating: nil, parts: .init(), pending: true), workout: workout)
    let words = try #require(ComplianceWords(item))
    #expect(words.label == "Not scored")
    #expect(words.provisional)
    #expect(
      words.why
        == "Time, distance and load are not scored: a step lasts until you press lap, so how long it takes is yours to choose."
    )
  }

  @Test func nothingIsSaidWithoutAPairing() throws {
    #expect(ComplianceWords(try CalendarSyncTests.workout("Threshold")) == nil)
  }

  @Test func theAthletesPairingClaimsTheActivityFirstAndTheRestAreUnplanned() throws {
    let auto = try paired(nil, by: .auto, activity: "a")
    var mine = try paired(nil, by: .athlete, activity: "a")
    mine.position = 1
    let day = CalendarRange.Day(
      day: saturday, planned: [auto, mine],
      activities: [CalendarActivity(id: "a"), CalendarActivity(id: "b")])
    let pairs = CalendarDayPairs(day)
    #expect(pairs.planned.map(\.done?.id) == [nil, "a"])
    #expect(pairs.unplanned.map(\.id) == ["b"])
  }

  @Test func aMeterFillsToWhatWasDoneAndMarksThePlanWhenDoneIsMore() {
    #expect(CalendarMeter(done: 0, planned: 0) == CalendarMeter(done: 0, planned: 0))
    #expect(CalendarMeter(done: 0, planned: 0).fill == 0)
    #expect(CalendarMeter(done: 30, planned: 60).fill == 0.5)
    #expect(CalendarMeter(done: 30, planned: 60).mark == nil)
    #expect(CalendarMeter(done: 120, planned: 60).fill == 1)
    #expect(CalendarMeter(done: 120, planned: 60).mark == 0.5)
  }

  @Test func weeksAreNamedFromTheAthletesToday() {
    let monday = saturday.monday
    #expect(monday == SettingDay("2026-11-09"))
    #expect(CalendarWeekName.of(monday, today: saturday) == "This week")
    #expect(CalendarWeekName.of(monday.adding(days: -7), today: saturday) == "Last week")
    #expect(CalendarWeekName.of(monday.adding(days: 7), today: saturday) == "Next week")
    #expect(CalendarWeekName.of(monday.adding(days: 14), today: saturday).contains("–"))
  }
}
