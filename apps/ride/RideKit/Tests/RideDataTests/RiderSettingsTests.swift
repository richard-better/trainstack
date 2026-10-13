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
    settings.add(
      FTPTest(date: .now, kind: .ramp, ftp: 230, scope: .all), updatesFTP: false)
    settings.setWeight(68.5)
    settings.save(to: defaults)
    #expect(RiderSettings.load(from: defaults) == settings)
  }

  @Test func weighsTheDefaultUntilSet() {
    var settings = RiderSettings()
    #expect(settings.weight == 75)
    settings.setWeight(82)
    settings.setWeight(5)
    #expect(settings.weight == 82)
  }

  @Test func loadsSettingsSavedBeforeRiderWeightWithTheDefault() throws {
    let defaults = try freshDefaults()
    var settings = RiderSettings()
    settings.history.record([.threshold(.ftp, scope: .all, value: 220)], on: .now)
    var saved = try #require(
      JSONSerialization.jsonObject(with: JSONEncoder().encode(settings)) as? [String: Any])
    saved["weight"] = nil
    defaults.set(try JSONSerialization.data(withJSONObject: saved), forKey: "riderSettings")
    let loaded = RiderSettings.load(from: defaults)
    #expect(loaded.weight == 75)
    #expect(loaded.history.current.value(of: .ftp, in: .all) == 220)
  }

  @Test func bringsOverTheValuesSavedBeforeZoneHistory() throws {
    let defaults = try freshDefaults()
    defaults.set(186, forKey: "riderProfile.maxHeartRate")
    defaults.set(100_000, forKey: "riderProfile.ftp")
    let profile = RiderSettings.load(from: defaults).history.current
    #expect(profile.value(of: .maxHeartRate, in: .all) == 186)
    #expect(profile.value(of: .ftp, in: .all) == nil)
  }

  @Test func setsFTPFromATestOnTheDayOfTheTest() throws {
    var settings = RiderSettings()
    settings.history.record([.threshold(.ftp, scope: .all, value: 200)], on: .distantPast)
    let testDay = Date.now.addingTimeInterval(-10 * 86400)
    settings.add(
      FTPTest(date: testDay, kind: .twentyMinute, ftp: 215, scope: .all), updatesFTP: true)
    settings.add(FTPTest(date: .now, kind: .other, ftp: 230, scope: .all), updatesFTP: false)
    #expect(settings.ftpTests(in: .all).map(\.ftp) == [215, 230])
    #expect(settings.history.profile(on: testDay).value(of: .ftp, in: .all) == 215)
    #expect(settings.history.current.value(of: .ftp, in: .all) == 215)
    settings.removeFTPTest(try #require(settings.ftpTests.first?.id))
    #expect(settings.ftpTests.map(\.ftp) == [230])
    #expect(settings.history.current.value(of: .ftp, in: .all) == 215)
  }
}
