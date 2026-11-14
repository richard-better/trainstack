import HealthKit
import RideData
import Testing

@testable import RideUI

struct HealthSportTests {
  @Test func mapsHealthWorkoutsOntoTheSportsTrainstackModels() {
    #expect(HealthSport(.running, indoor: false) == .running)
    #expect(HealthSport(.running, indoor: true) == .treadmillRunning)
    #expect(HealthSport(.cycling, indoor: false) == .cycling)
    #expect(HealthSport(.cycling, indoor: true) == .indoorCycling)
    #expect(HealthSport(.swimming, indoor: false, swimmingLocation: .pool) == .poolSwimming)
    #expect(
      HealthSport(.swimming, indoor: false, swimmingLocation: .openWater) == .openWaterSwimming)
    #expect(HealthSport(.rowing, indoor: true) == .indoorRowing)
    #expect(HealthSport(.traditionalStrengthTraining, indoor: true) == .strength)
    #expect(HealthSport(.functionalStrengthTraining, indoor: false) == .strength)
    #expect(HealthSport(.climbing, indoor: true) == .indoorClimbing)
  }

  @Test func aWorkoutWithNoSportOfItsOwnIsStillImported() {
    #expect(HealthSport(.socialDance, indoor: true) == .other)
    #expect(HealthSport(.tennis, indoor: false) == .other)
  }
}
