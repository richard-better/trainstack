import Testing

@testable import RideData

struct ZoneTests {
  private func zones(
    _ model: ZoneModel, _ thresholds: [Threshold: Int], customLimits: [Int]? = nil
  ) -> MetricZones {
    MetricZones(
      thresholds: thresholds, choice: ZoneChoice(model: model, customLimits: customLimits))
  }

  @Test func calculatesFrielCyclingZonesFromLactateThreshold() throws {
    let set = try #require(zones(.frielCycling, [.lactateThresholdHeartRate: 170]).zones)
    // 81, 90, 94, 100, 103 and 107% of 170, rounded, start zones 2 to 5c.
    #expect(set.limits == [137, 152, 159, 169, 174, 181])
    #expect(set.zones.map(\.label) == ["1", "2", "3", "4", "5a", "5b", "5c"])
    #expect(set.zones.first?.start == nil)
    #expect(set.zones.last?.start == 182)
    #expect(set.zones.last?.end == nil)
  }

  @Test func calculatesKarvonenZonesFromHeartRateReserve() throws {
    let set = try #require(
      zones(.karvonen, [.maxHeartRate: 190, .restingHeartRate: 50]).zones)
    // 50 plus 60, 70, 80 and 90% of the 140 bpm reserve.
    #expect(set.limits == [133, 147, 161, 175])
  }

  @Test func calculatesCogganPowerZonesFromFTP() throws {
    let set = try #require(zones(.coggan6, [.ftp: 200]).zones)
    #expect(set.limits == [111, 151, 181, 211, 241])
    #expect(set.zone(containing: 111).name == "Active recovery")
    #expect(set.zone(containing: 112).name == "Endurance")
    #expect(set.zone(containing: 1000).name == "Anaerobic")
  }

  @Test func splitsSeilerZonesAtTheMeasuredThresholds() throws {
    let heartRate = try #require(
      zones(.seilerHeartRate, [.aerobicThresholdHeartRate: 142, .lactateThresholdHeartRate: 168])
        .zones)
    #expect(heartRate.limits == [141, 167])
    #expect(heartRate.zone(containing: 142).name == "Moderate")
    #expect(heartRate.zone(containing: 168).name == "Hard")
    let power = try #require(
      zones(.seilerPower, [.aerobicThresholdPower: 190, .ftp: 260]).zones)
    #expect(power.limits == [189, 259])
  }

  @Test func needsBothSeilerThresholdsInOrder() {
    let missing = zones(.seilerHeartRate, [.lactateThresholdHeartRate: 168])
    #expect(missing.zones == nil)
    #expect(missing.missingThresholds == [.aerobicThresholdHeartRate])
    let reversed = zones(
      .seilerHeartRate, [.aerobicThresholdHeartRate: 170, .lactateThresholdHeartRate: 168])
    #expect(reversed.zones == nil)
    #expect(reversed.missingThresholds.isEmpty)
  }

  @Test func calculatesPaceZonesFromSlowToFast() throws {
    // A threshold pace of 4:00 per kilometre.
    let set = try #require(zones(.frielRunningPace, [.thresholdPace: 240]).zones)
    // Zones 2 to 5c start at 129, 113, 105, 100, 96 and 90% of 240 seconds.
    #expect(set.limits == [311, 272, 253, 241, 231, 217])
    #expect(set.zones[1].start == 310)
    #expect(set.zone(containing: 400).index == 0)
    #expect(set.zone(containing: 240).label == "5a")
    #expect(set.zone(containing: 200).label == "5c")
    #expect(set.limits(settingZone: 0, endTo: 272) == nil)
    #expect(set.limits(settingZone: 5, endTo: 1) == nil)
  }

  @Test func needsTheThresholdsOfTheChosenModel() {
    let karvonen = zones(.karvonen, [.maxHeartRate: 190])
    #expect(karvonen.zones == nil)
    #expect(karvonen.missingThresholds == [.restingHeartRate])
  }

  @Test func keepsCustomLimitsWithoutThresholds() throws {
    let custom = zones(.percentOfMax, [:], customLimits: [1, 2, 3, 4])
    #expect(try #require(custom.zones).limits == [1, 2, 3, 4])
    #expect(custom.missingThresholds.isEmpty)
  }

  @Test func movesTheNextZoneWithAnEditedLimit() throws {
    let set = try #require(zones(.percentOfMax, [.maxHeartRate: 200]).zones)
    #expect(set.limits == [119, 139, 159, 179])
    #expect(set.limits(settingZone: 1, endTo: 145) == [119, 145, 159, 179])
    #expect(set.limits(settingZone: 3, endTo: 250) == [119, 139, 159, 250])
  }

  @Test func refusesALimitThatEmptiesAZone() throws {
    let set = try #require(zones(.percentOfMax, [.maxHeartRate: 200]).zones)
    #expect(set.limits(settingZone: 1, endTo: 119) == nil)
    #expect(set.limits(settingZone: 1, endTo: 159) == nil)
    #expect(set.limits(settingZone: 0, endTo: -1) == nil)
    #expect(set.limits(settingZone: 4, endTo: 200) == nil)
  }

  @Test func everyModelHasALabelAndOrderedLimitForEachZone() throws {
    let thresholds: [Threshold: Int] = [
      .lactateThresholdHeartRate: 170, .maxHeartRate: 190, .restingHeartRate: 50, .ftp: 250,
      .thresholdPace: 240, .aerobicThresholdHeartRate: 140, .aerobicThresholdPower: 180,
    ]
    for model in ZoneModel.allCases {
      #expect(model.zoneLabels.count == model.zoneCount)
      let limits = try #require(model.limits(from: thresholds))
      #expect(limits.count == model.zoneCount - 1, "\(model)")
      #expect(ZoneSet(model: model, limits: limits) != nil, "\(model)")
    }
    let offered = Set(
      ZoneMetric.allCases.flatMap { metric in
        [nil, .running, .swimming].flatMap { sport in
          ZoneModel.groups(for: metric, in: sport).flatMap(\.models)
            .filter { $0.metric == metric }
        }
      })
    #expect(offered == Set(ZoneModel.allCases))
  }
}
