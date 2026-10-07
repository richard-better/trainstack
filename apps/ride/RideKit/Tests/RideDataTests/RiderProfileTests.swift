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

  @Test func dropsSavedValuesOutsideTheirRange() throws {
    let defaults = try freshDefaults()
    defaults.set(5, forKey: "riderProfile.maxHeartRate")
    defaults.set(100_000, forKey: "riderProfile.ftp")
    #expect(RiderProfile.load(from: defaults) == RiderProfile())
  }
}
