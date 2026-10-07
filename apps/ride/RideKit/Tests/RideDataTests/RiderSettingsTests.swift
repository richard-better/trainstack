import Foundation
import Testing

@testable import RideData

struct RiderSettingsTests {
  private func freshDefaults() throws -> UserDefaults {
    let name = "RiderSettingsTests-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: name))
    defaults.removePersistentDomain(forName: name)
    return defaults
  }

  @Test func startsEmpty() throws {
    let settings = RiderSettings.load(from: try freshDefaults())
    #expect(settings == RiderSettings())
    #expect(settings.history.current.value(of: .ftp, in: .all) == nil)
  }

  @Test func savesAndLoads() throws {
    let defaults = try freshDefaults()
    var settings = RiderSettings()
    settings.history.record([.threshold(.ftp, scope: .all, value: 220)], on: .now)
    settings.save(to: defaults)
    #expect(RiderSettings.load(from: defaults) == settings)
  }

  @Test func bringsOverTheValuesSavedBeforeZoneHistory() throws {
    let defaults = try freshDefaults()
    defaults.set(186, forKey: "riderProfile.maxHeartRate")
    defaults.set(100_000, forKey: "riderProfile.ftp")
    let profile = RiderSettings.load(from: defaults).history.current
    #expect(profile.value(of: .maxHeartRate, in: .all) == 186)
    #expect(profile.value(of: .ftp, in: .all) == nil)
  }
}
