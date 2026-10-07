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
    // Two weeks off: fatigue drains, most fitness stays, and form turns positive.
    let afterRest = load[20]
    #expect(afterRest.fatigue < afterBlock.fatigue / 4)
    #expect(afterRest.fitness > afterBlock.fitness * 0.6)
    #expect(afterRest.form > 0)
  }

  @Test func settlesOnTheDailyAverage() {
    let stress = Dictionary(uniqueKeysWithValues: (0..<400).map { (day($0), 50.0) })
    let last = TrainingLoad.daily(
      stress: stress, from: day(0), through: day(399), calendar: calendar
    ).last
    #expect(abs((last?.fitness ?? 0) - 50) < 0.1)
    #expect(abs((last?.form ?? 1)) < 0.1)
  }

  @Test func addsUpZoneTimeAcrossRides() throws {
    func zones(ftp: Int) throws -> ZoneSet {
      try #require(MetricZones(thresholds: [.ftp: ftp], choice: ZoneChoice(model: .coggan6)).zones)
    }
    // The FTP rose between the rides, which moves the zones but keeps them the same zones.
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

  @Test func groupsZonesIntoThreeIntensities() {
    #expect(
      PowerZone.allCases.map(\.intensity) == [.easy, .easy, .moderate, .moderate, .hard, .hard])
    #expect(ZoneModel.percentOfMax.intensities == [.easy, .easy, .moderate, .moderate, .hard])
    for model in ZoneModel.allCases {
      #expect(model.intensities.count == model.zoneCount, "\(model)")
    }
  }
}
