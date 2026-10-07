import Testing

@testable import RideData

struct ZoneTests {
  @Test func calculatesFrielCyclingZonesFromLactateThreshold() throws {
    let profile = RiderProfile(
      lactateThresholdHeartRate: 170,
      heartRateZoneChoice: ZoneChoice(model: .frielCycling))
    let zones = try #require(profile.zones(for: .heartRate))
    // 81, 90, 94, 100, 103 and 107% of 170, rounded, start zones 2 to 5c.
    #expect(zones.upperLimits == [137, 152, 159, 169, 174, 181])
    #expect(zones.zones.map(\.label) == ["1", "2", "3", "4", "5a", "5b", "5c"])
    #expect(zones.zones.first?.lowerLimit == 0)
    #expect(zones.zones.last?.lowerLimit == 182)
    #expect(zones.zones.last?.upperLimit == nil)
  }

  @Test func calculatesKarvonenZonesFromHeartRateReserve() throws {
    let profile = RiderProfile(
      maxHeartRate: 190, restingHeartRate: 50,
      heartRateZoneChoice: ZoneChoice(model: .karvonen))
    let zones = try #require(profile.zones(for: .heartRate))
    // 50 plus 60, 70, 80 and 90% of the 140 bpm reserve.
    #expect(zones.upperLimits == [133, 147, 161, 175])
  }

  @Test func calculatesCogganPowerZonesFromFTP() throws {
    let zones = try #require(RiderProfile(ftp: 200).zones(for: .power))
    #expect(zones.upperLimits == [111, 151, 181, 211, 241])
    #expect(zones.zone(containing: 111).name == "Active recovery")
    #expect(zones.zone(containing: 112).name == "Endurance")
    #expect(zones.zone(containing: 1000).name == "Anaerobic")
  }

  @Test func needsTheThresholdsOfTheChosenModel() {
    let profile = RiderProfile(
      maxHeartRate: 190, heartRateZoneChoice: ZoneChoice(model: .karvonen))
    #expect(profile.zones(for: .heartRate) == nil)
    #expect(profile.missingThresholds(for: .heartRate) == [.restingHeartRate])
    #expect(RiderProfile().missingThresholds(for: .power) == [.ftp])
  }

  @Test func keepsCustomLimitsWhenThresholdsChange() throws {
    var profile = RiderProfile(
      heartRateZoneChoice: ZoneChoice(model: .percentOfMax, customUpperLimits: [1, 2, 3, 4]))
    profile.maxHeartRate = 190
    #expect(try #require(profile.zones(for: .heartRate)).upperLimits == [1, 2, 3, 4])
    #expect(profile.missingThresholds(for: .heartRate).isEmpty)
  }

  @Test func movesTheNextZoneWithAnEditedLimit() throws {
    let zones = try #require(RiderProfile(maxHeartRate: 200).zones(for: .heartRate))
    #expect(zones.upperLimits == [119, 139, 159, 179])
    #expect(zones.upperLimits(settingZone: 1, upperLimitTo: 145) == [119, 145, 159, 179])
    #expect(zones.upperLimits(settingZone: 3, upperLimitTo: 250) == [119, 139, 159, 250])
  }

  @Test func refusesALimitThatEmptiesAZone() throws {
    let zones = try #require(RiderProfile(maxHeartRate: 200).zones(for: .heartRate))
    #expect(zones.upperLimits(settingZone: 1, upperLimitTo: 119) == nil)
    #expect(zones.upperLimits(settingZone: 1, upperLimitTo: 159) == nil)
    #expect(zones.upperLimits(settingZone: 0, upperLimitTo: -1) == nil)
    #expect(zones.upperLimits(settingZone: 4, upperLimitTo: 200) == nil)
  }

  @Test func everyModelHasALabelAndAscendingLimitForEachZone() throws {
    let profile = RiderProfile(
      lactateThresholdHeartRate: 170, maxHeartRate: 190, restingHeartRate: 50, ftp: 250)
    for model in ZoneModel.allCases {
      #expect(model.zoneLabels.count == model.zoneCount)
      #expect(model.lowerLimitPercents.count == model.zoneCount - 1)
      let limits = try #require(model.upperLimits(for: profile))
      #expect(ZoneSet(model: model, upperLimits: limits) != nil, "\(model)")
    }
    let grouped = ZoneMetric.allCases.flatMap { metric in
      ZoneModel.groups(for: metric).flatMap(\.models).map {
        #expect($0.metric == metric)
        return $0
      }
    }
    #expect(Set(grouped) == Set(ZoneModel.allCases))
  }
}
