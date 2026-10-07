import Foundation
import Testing

@testable import RideData

struct WorkoutTemplateTests {
  /// 10 minutes easy, 5 at threshold, 5 easy.
  private let template = WorkoutTemplate(
    name: "Test 20", category: .threshold,
    steps: [
      .init(duration: 600, intensity: 0.5), .init(duration: 300, intensity: 1),
      .init(duration: 300, intensity: 0.5),
    ])

  @Test func scoresStressAs100ForAnHourAtFTP() {
    let hour = WorkoutTemplate(
      name: "FTP", category: .threshold, steps: [.init(duration: 3600, intensity: 1)])
    #expect(hour.stressScore == 100)
    // 15 minutes at 50% is 6.25 and 5 minutes at 100% is 8.33.
    #expect(template.stressScore == 15)
  }

  @Test func convertsToWattsForARider() {
    #expect(template.workout(ftp: 250).steps.map(\.targetPower) == [125, 250, 125])
  }

  @Test func stretchesOnlyTheEasyStepsWhenLengthened() {
    let fitted = template.fitted(to: 40 * 60)
    #expect(fitted.duration == 40 * 60)
    #expect(fitted.steps.map(\.duration) == [1400, 300, 700])
    #expect(fitted.name == "Test 40")
  }

  @Test func shrinksEverythingWhenTheHardStepsDoNotFit() {
    let fitted = template.fitted(to: 4 * 60)
    #expect(fitted.duration == 4 * 60)
    #expect(fitted.steps.map(\.duration) == [120, 60, 60])
  }

  @Test func libraryWorkoutsLastWhatTheirNamesSay() throws {
    for name in [
      "Recovery 30", "Long endurance 90", "Threshold classic 60", "Ramp openers 30",
      "Pixel sprints 30",
    ] {
      let workout = try #require(WorkoutTemplate.named(name))
      let minutes = try #require(name.split(separator: " ").last.flatMap { Int($0) })
      #expect(workout.duration == TimeInterval(minutes * 60), "\(name)")
    }
  }

  @Test func zonesStepsByShareOfFTP() {
    #expect([0.5, 0.6, 0.8, 1, 1.1, 1.3].map(PowerZone.zone(intensity:)) == PowerZone.allCases)
  }
}
