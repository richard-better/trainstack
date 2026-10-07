import Foundation
import Testing

@testable import RideData

struct RiderProfileTests {
  private func freshDefaults() throws -> UserDefaults {
    let name = "RiderProfileTests-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: name))
    defaults.removePersistentDomain(forName: name)
    return defaults
  }

  @Test func startsEmpty() throws {
    #expect(RiderProfile.load(from: try freshDefaults()) == RiderProfile())
  }

  @Test func savesAndLoadsBothValues() throws {
    let defaults = try freshDefaults()
    RiderProfile(maxHeartRate: 186, ftp: 200).save(to: defaults)
    #expect(RiderProfile.load(from: defaults) == RiderProfile(maxHeartRate: 186, ftp: 200))
  }

  @Test func forgetsAClearedValue() throws {
    let defaults = try freshDefaults()
    RiderProfile(maxHeartRate: 186, ftp: 200).save(to: defaults)
    RiderProfile(maxHeartRate: nil, ftp: 200).save(to: defaults)
    #expect(RiderProfile.load(from: defaults) == RiderProfile(maxHeartRate: nil, ftp: 200))
  }

  @Test func savesAndLoadsThresholdsAndZoneChoices() throws {
    let defaults = try freshDefaults()
    let profile = RiderProfile(
      lactateThresholdHeartRate: 172, maxHeartRate: 189, restingHeartRate: 52, ftp: 220,
      heartRateZoneChoice: ZoneChoice(model: .frielCycling, customUpperLimits: [1, 2, 3, 4, 5, 6]),
      powerZoneChoice: ZoneChoice(model: .polarized))
    profile.save(to: defaults)
    #expect(RiderProfile.load(from: defaults) == profile)
  }

  @Test func dropsCustomLimitsThatNoLongerFitTheirModel() throws {
    let defaults = try freshDefaults()
    RiderProfile(heartRateZoneChoice: ZoneChoice(model: .karvonen, customUpperLimits: [3, 2, 1]))
      .save(to: defaults)
    #expect(RiderProfile.load(from: defaults).heartRateZoneChoice == ZoneChoice(model: .karvonen))
  }

  @Test func dropsSavedValuesOutsideTheirRange() throws {
    let defaults = try freshDefaults()
    defaults.set(5, forKey: "riderProfile.maxHeartRate")
    defaults.set(100_000, forKey: "riderProfile.ftp")
    #expect(RiderProfile.load(from: defaults) == RiderProfile())
  }
}
