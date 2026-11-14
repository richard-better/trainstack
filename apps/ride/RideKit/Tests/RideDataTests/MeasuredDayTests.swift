import Foundation
import Testing

@testable import RideData

struct MeasuredDayTests {
  private let calendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Budapest")!
    return calendar
  }()

  private func at(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
    calendar.date(
      from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute))!
  }

  private let today = SettingDay("2026-11-14")!

  @Test func sleepIsTheNightBeforeEverySourceMergedSoNoMinuteCountsTwice() {
    let watch = [
      DateInterval(start: at(13, 23, 10), end: at(14, 2)),
      DateInterval(start: at(14, 2, 20), end: at(14, 6, 40)),
    ]
    let ring = [DateInterval(start: at(13, 23, 30), end: at(14, 6))]
    let afternoonNap = [DateInterval(start: at(14, 14), end: at(14, 15))]
    let days = MeasuredDay.days(
      [today], asleep: watch + ring + afternoonNap, restingHeartRate: [], hrv: [],
      calendar: calendar)
    #expect(days[0].sleepSeconds == (7 * 60 + 30) * 60)
    #expect(days[0].restingHeartRateBpm == nil)
  }

  @Test func restingHeartRateIsTheDaysAndHRVTheNightsTakenAsleep() {
    let days = MeasuredDay.days(
      [today], asleep: [DateInterval(start: at(13, 23), end: at(14, 7))],
      restingHeartRate: [.init(date: at(14, 8), value: 51), .init(date: at(13, 8), value: 60)],
      hrv: [
        .init(date: at(14, 3), value: 60), .init(date: at(14, 5), value: 66),
        .init(date: at(14, 9), value: 30),
      ],
      calendar: calendar)
    #expect(days[0].restingHeartRateBpm == 51)
    #expect(days[0].hrvMs == 63)
  }

  @Test func withoutSleepHRVIsTheNightsReadingsFromNoonToNoon() {
    let days = MeasuredDay.days(
      [today], asleep: [], restingHeartRate: [],
      hrv: [.init(date: at(13, 20), value: 40), .init(date: at(14, 13), value: 90)],
      calendar: calendar)
    #expect(days[0].hrvMs == 40)
    #expect(days[0].sleepSeconds == nil)
  }

  @Test func aDayWithNothingMeasuredIsEmpty() {
    let days = MeasuredDay.days(
      [today], asleep: [], restingHeartRate: [], hrv: [], calendar: calendar)
    #expect(days[0].isEmpty)
  }
}
