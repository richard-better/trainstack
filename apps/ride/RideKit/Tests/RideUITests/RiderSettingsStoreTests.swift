import Foundation
import RideData
import Testing

@testable import RideUI

struct RiderSettingsStoreTests {
  private let store = RiderSettingsStore(settings: RiderSettings())

  @Test func editsThresholdsAndIgnoresValuesOutOfRange() {
    store[.ftp, .all] = 250
    #expect(store[.ftp, .all] == 250)
    store[.ftp, .all] = -1
    #expect(store[.ftp, .all] == 250)
  }

  @Test func editsWeightAndIgnoresValuesOutOfRange() {
    #expect(store.weight == 75)
    store.weight = 68.5
    #expect(store.weight == 68.5)
    store.weight = 0
    #expect(store.weight == 68.5)
  }

  @Test func movingAZoneEndMakesTheZonesCustomUntilAModelIsChosen() throws {
    store[.ftp, .all] = 200
    let model = try #require(store[modelFor: .power, in: .all])
    let end = try #require(store[endOfZone: 0, for: .power, in: .all])

    store[endOfZone: 0, for: .power, in: .all] = end + 5
    #expect(store[endOfZone: 0, for: .power, in: .all] == end + 5)
    #expect(store[modelFor: .power, in: .all] == nil)

    store[modelFor: .power, in: .all] = model
    #expect(store[endOfZone: 0, for: .power, in: .all] == end)
  }

  @Test func choosingNoModelLeavesCustomZonesAsTheyAre() throws {
    store[.ftp, .all] = 200
    let end = try #require(store[endOfZone: 0, for: .power, in: .all])
    store[endOfZone: 0, for: .power, in: .all] = end + 5

    store[modelFor: .power, in: .all] = nil
    #expect(store[endOfZone: 0, for: .power, in: .all] == end + 5)
  }

  @Test func ignoresAZoneEndThatWouldEmptyAZone() throws {
    store[.ftp, .all] = 200
    let firstEnd = try #require(store[endOfZone: 0, for: .power, in: .all])
    let secondEnd = try #require(store[endOfZone: 1, for: .power, in: .all])

    store[endOfZone: 0, for: .power, in: .all] = secondEnd
    #expect(store[endOfZone: 0, for: .power, in: .all] == firstEnd)
    #expect(store[modelFor: .power, in: .all] != nil)
  }

  @Test func theIndoorFTPIsCyclingsOwnOrElseDefaults() {
    store[.ftp, .all] = 200
    #expect(store.ftp == 200)
    store.setListed(true, .cycling)
    store[usesDefault: .power, in: .cycling] = false
    store[.ftp, .sport(.cycling)] = 240
    #expect(store.ftp == 240)
  }

  @Test func analysesARideWithTheFTPInEffectOnItsDay() throws {
    let ride = try RideRecording.sample()
    var settings = RiderSettings()
    settings.record(
      [.threshold(.ftp, scope: .all, value: 180)], on: ride.startDate.addingTimeInterval(-86_400))
    let store = RiderSettingsStore(settings: settings)
    store[.ftp, .all] = 260
    #expect(store.ftp(for: ride) == 180)
    #expect(store.ftp == 260)
  }

  @Test func savesEditsAsTheyAreMade() throws {
    let name = "RiderSettingsStoreTests-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: name))
    defer { defaults.removePersistentDomain(forName: name) }
    let store = RiderSettingsStore(defaults: defaults)
    store[.ftp, .all] = 230
    store.weight = 70
    let reopened = RiderSettingsStore(defaults: defaults)
    #expect(reopened[.ftp, .all] == 230)
    #expect(reopened.weight == 70)
  }

  @Test func switchesASportBetweenDefaultAndItsOwnZones() {
    store.setListed(true, .cycling)
    #expect(store[usesDefault: .power, in: .cycling])
    store[usesDefault: .power, in: .cycling] = false
    #expect(!store[usesDefault: .power, in: .cycling])
  }

  @Test func savesHowPowerIsShown() throws {
    let name = "RiderSettingsStoreTests-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: name))
    defer { defaults.removePersistentDomain(forName: name) }
    #expect(RiderSettingsStore(defaults: defaults).powerDisplay == .threeSeconds)
    RiderSettingsStore(defaults: defaults).powerDisplay = .instant
    #expect(RiderSettingsStore(defaults: defaults).powerDisplay == .instant)
  }
}
