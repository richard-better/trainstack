import Foundation
import Testing

@testable import RideData

struct BuiltinWorkoutIDTests {
  @Test func namesEachBuiltInAsTheServerDoes() {
    #expect(
      WorkoutTemplate.library.map(\.builtinID) == [
        "zone-3-3x10", "threshold-waves-3x12", "ramp-openers-30", "over-unders-2x10",
        "long-endurance-90", "vo2-max-booster", "tabata-4x40-20", "recovery-30",
        "threshold-classic-60", "pixel-sprints-30", "quick-test-45s",
      ])
  }

  @Test func copiesABuiltInAsTheServerDoes() throws {
    let template = try #require(WorkoutTemplate.named("Recovery 30"))
    let copy = template.trainStackWorkout
    #expect(copy.focus == .endurance)
    #expect(copy.description == template.about)
    #expect(copy.rideability.planned?.workout(ftp: 230) == template.workout(ftp: 230))
  }
}
