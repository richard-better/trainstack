import RideData
import SwiftUI
import Testing

@testable import RideStyle

struct ZoneColorsTests {
  @Test func runsFromGreyForRecoveryToRedForTheHardest() {
    #expect(Zone.color(index: 0, zoneCount: 7) == .gray)
    #expect(Zone.color(index: 5, zoneCount: 7) == .red)
    #expect(Zone.color(index: 6, zoneCount: 7) == Color(red: 0.84, green: 0, blue: 0.08))
  }

  @Test func colorsThreeZoneModelsBlueYellowAndRed() {
    #expect((0..<3).map { Zone.color(index: $0, zoneCount: 3) } == [.blue, .yellow, .red])
  }

  @Test func givesZonesPastTheEndsOfThePaletteTheNearestColor() {
    #expect(Zone.color(index: -1, zoneCount: 5) == .gray)
    #expect(Zone.color(index: 9, zoneCount: 3) == .red)
  }

  @Test func matchesPowerZonesToTheZoneAtTheSamePlace() {
    for zone in PowerZone.allCases {
      #expect(zone.color == Zone.color(index: zone.rawValue, zoneCount: PowerZone.allCases.count))
    }
  }
}
