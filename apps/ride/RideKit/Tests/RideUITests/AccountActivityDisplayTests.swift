import Foundation
import RideStrava
import Testing

@testable import RideUI

struct AccountActivityDisplayTests {
  @Test func anActivityWithoutANameIsCalledByItsSport() {
    #expect(AccountActivity(id: "a", sport: "running", indoor: false).title == "Running")
    #expect(AccountActivity(id: "a", sport: "cycling", indoor: true).title == "Indoor cycling")
    #expect(AccountActivity(id: "a", sport: nil, indoor: nil).title == "Activity")
    #expect(AccountActivity(id: "a", name: "  Sweet spot ").title == "Sweet spot")
    #expect(
      AccountActivity(
        id: "a", sport: nil, indoor: nil, logged: LoggedSummary(sport: "bouldering")
      ).title == "Bouldering")
  }

  @Test func aLoggedSessionIsShownByWhatItSumsUpToNotAsARide() {
    let strength = AccountActivity(
      id: "s", sport: "strength", indoor: nil, file: nil, statistics: ["elapsed_s": 3600],
      logged: LoggedSummary(
        sport: "strength", exercises: 1, sets: 18, reps: 120, volumeKg: 1000, unit: "lb"))
    #expect(strength.rowFigures == ["1:00:00", "1 exercise", "18 sets"])
    #expect(strength.stats.map(\.label) == ["Duration", "Exercises", "Sets", "Reps", "Volume"])
    #expect(strength.stats.last?.value == 2205.0.formatted(.number.precision(.fractionLength(0))))
    #expect(strength.stats.last?.unit == "lb")
    #expect(strength.symbol == "dumbbell")
    let bouldering = AccountActivity(
      id: "b", sport: "bouldering", indoor: nil, file: nil,
      logged: LoggedSummary(sport: "bouldering", problems: 12, tops: 1, hardestTop: "6B+"))
    #expect(bouldering.rowFigures == ["12 problems", "1 top"])
    #expect(bouldering.stats.map(\.value) == ["12", "1", "6B+"])
  }

  @Test func aRunShowsItsPaceAndARideItsSpeed() {
    let run = AccountActivity(
      id: "r", sport: "running", indoor: false,
      statistics: ["timer_s": 1500, "distance_m": 5000, "average_speed_mps": 1000.0 / 300])
    #expect(run.stats.first { $0.label == "Avg pace" }?.value == "5:00")
    let ride = AccountActivity(
      id: "c", sport: "cycling", indoor: false, statistics: ["average_speed_mps": 10])
    #expect(
      ride.stats.first { $0.label == "Avg speed" }?.value
        == 36.0.formatted(.number.precision(.fractionLength(1))))
  }

  @Test func theZoneBarFollowsTheZonesInOrderPowerFirst() {
    let activity = AccountActivity(
      id: "a",
      statistics: [
        "time_in_heart_rate_zone_1_s": 100, "time_in_heart_rate_zone_5a_s": 100,
        "time_in_heart_rate_zone_4_s": 200,
      ])
    #expect(activity.zoneFractions == [0.25, 0.5, 0.25])
    var withPower = activity
    withPower.statistics["time_in_power_zone_2_s"] = 30
    withPower.statistics["time_in_power_zone_1_s"] = 10
    #expect(withPower.zoneFractions == [0.25, 0.75])
  }
}
