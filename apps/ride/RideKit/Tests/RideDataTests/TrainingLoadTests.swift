import Foundation
import Testing

@testable import RideData

struct TrainingLoadTests {
  private var calendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .gmt
    return calendar
  }

  private func day(_ offset: Int) -> Date {
    calendar.date(byAdding: .day, value: offset, to: Date(timeIntervalSince1970: 0))!
  }

  @Test func fatigueRisesAndFallsFasterThanFitness() {
    let stress = Dictionary(uniqueKeysWithValues: (0..<7).map { (day($0), 100.0) })
    let load = TrainingLoad.daily(
      stress: stress, from: day(0), through: day(20), calendar: calendar)
    #expect(load.count == 21)
    let afterBlock = load[6]
    #expect(afterBlock.fatigue > afterBlock.fitness)
    #expect(afterBlock.form < 0)
    let afterRest = load[20]
    #expect(afterRest.fatigue < afterBlock.fatigue / 4)
    #expect(afterRest.fitness > afterBlock.fitness * 0.6)
    #expect(afterRest.form > 0)
  }

  @Test func givesOneLoadForEachDayStartingFromNoLoad() {
    let load = TrainingLoad.daily(
      stress: [day(0): 10], from: day(0).addingTimeInterval(3600), through: day(2),
      calendar: calendar)
    #expect(load.map(\.date) == [day(0), day(1), day(2)])
    #expect(load[0].fitness == 10 / TrainingLoad.fitnessDays)
    #expect(load[0].fatigue == 10 / TrainingLoad.fatigueDays)
  }

  @Test func ignoresStressOutsideTheDays() {
    let load = TrainingLoad.daily(
      stress: [day(-1): 100, day(3): 100], from: day(0), through: day(2), calendar: calendar)
    #expect(load.allSatisfy { $0.stress == 0 && $0.fitness == 0 && $0.fatigue == 0 })
  }

  @Test func addsUpEachDaysStressLeavingOutRidesWithoutAnFTPOrPower() throws {
    let hourAtFTP = (0...3600).map { RideRecording.Sample(elapsed: Double($0), power: 200) }
    let ride = RideRecording(
      startDate: day(1).addingTimeInterval(3600), samples: hourAtFTP,
      summary: .init(duration: 3600))
    let laterThatDay = RideRecording(
      startDate: day(1).addingTimeInterval(7200), samples: hourAtFTP,
      summary: .init(duration: 3600))
    let withoutPower = RideRecording(
      startDate: day(2), samples: [.init(elapsed: 0, heartRate: 120)],
      summary: .init(duration: 0))
    let withoutFTP = RideRecording(
      startDate: day(3), samples: hourAtFTP, summary: .init(duration: 3600))
    let stress = [ride, laterThatDay, withoutPower, withoutFTP].stressByDay(calendar: calendar) {
      $0.startDate < day(3) ? 200 : nil
    }
    #expect(stress == [day(1): 200])
  }

  @Test func settlesOnTheDailyAverage() {
    let stress = Dictionary(uniqueKeysWithValues: (0..<400).map { (day($0), 50.0) })
    let last = TrainingLoad.daily(
      stress: stress, from: day(0), through: day(399), calendar: calendar
    ).last
    #expect(abs((last?.fitness ?? 0) - 50) < 0.1)
    #expect(abs((last?.form ?? 1)) < 0.1)
  }

  @Test func addsUpZoneTimeAcrossRidesEvenWhenTheFTPMovedTheZones() throws {
    func zones(ftp: Int) throws -> ZoneSet {
      try #require(MetricZones(thresholds: [.ftp: ftp], choice: ZoneChoice(model: .coggan6)).zones)
    }
    let before = try zones(ftp: 200).zones
    let after = try zones(ftp: 220).zones
    let first = [
      ZoneShare(zone: before[1], seconds: 300, fraction: 0.75),
      ZoneShare(zone: before[2], seconds: 100, fraction: 0.25),
    ]
    let second = [ZoneShare(zone: after[1], seconds: 600, fraction: 1)]
    let combined = [first, second].combined()
    #expect(combined.map(\.zone.name) == ["Endurance", "Tempo"])
    #expect(combined.map(\.seconds) == [900, 100])
    #expect(combined.map(\.fraction) == [0.9, 0.1])
  }

  @Test func addsUpToNothingWhenNoRideHadZoneTime() {
    #expect([[ZoneShare]]().combined().isEmpty)
    #expect([[], []].combined().isEmpty)
  }

  @Test func groupsZonesIntoThreeIntensities() {
    #expect(
      PowerZone.allCases.map(\.intensity) == [.easy, .easy, .moderate, .moderate, .hard, .hard])
    #expect(ZoneModel.percentOfMax.intensities == [.easy, .easy, .moderate, .moderate, .hard])
    for model in ZoneModel.allCases {
      #expect(model.intensities.count == model.zoneCount, "\(model)")
    }
  }
}
