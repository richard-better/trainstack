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

  @Test func movingAZoneEndMakesTheZonesCustomUntilAModelIsChosen() throws {
    store[.ftp, .all] = 200
    let model = try #require(store[modelFor: .power, in: .all])
    let end = try #require(store[endOfZone: 0, for: .power, in: .all])

    store[endOfZone: 0, for: .power, in: .all] = end + 5
    #expect(store[endOfZone: 0, for: .power, in: .all] == end + 5)
    #expect(store[modelFor: .power, in: .all] == nil)

    // Choosing nothing leaves custom zones alone; choosing the model restores them.
    store[modelFor: .power, in: .all] = nil
    #expect(store[endOfZone: 0, for: .power, in: .all] == end + 5)
    store[modelFor: .power, in: .all] = model
    #expect(store[endOfZone: 0, for: .power, in: .all] == end)
  }

  @Test func switchesASportBetweenDefaultAndItsOwnZones() {
    store.setListed(true, .cycling)
    #expect(store[usesDefault: .power, in: .cycling])
    store[usesDefault: .power, in: .cycling] = false
    #expect(!store[usesDefault: .power, in: .cycling])
  }
}
