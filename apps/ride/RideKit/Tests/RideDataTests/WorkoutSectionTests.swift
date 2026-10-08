import Foundation
import Testing

@testable import RideData

struct WorkoutSectionTests {
  @Test func groupsAWarmUpRepeatsAndACoolDown() throws {
    let sections = try #require(WorkoutTemplate.named("Threshold classic 60")).sections
    #expect(sections.map(\.kind) == [.warmUp, .repeats(3), .coolDown])
    #expect(sections[0].steps.map(\.intensity) == [0.45, 0.55, 0.65, 0.72])
    #expect(sections[1].steps.map(\.intensity) == [0.95, 1.12, 0.6])
    // No recovery after the last block.
    #expect(sections[1].skippedInLastRepeat == 1)
    #expect(sections[1].duration == (3 * 16 - 5) * 60)
    #expect(sections[2].steps.map(\.intensity) == [0.5])
  }

  @Test func keepsTheFirstRepeatOutOfTheWarmUp() throws {
    let sections = try #require(WorkoutTemplate.named("Pixel sprints 30")).sections
    #expect(sections.map(\.kind) == [.warmUp, .repeats(8), .coolDown])
    #expect(sections[1].skippedInLastRepeat == 0)
  }

  @Test func marksEasyStepsBetweenEffortsAsRecovery() throws {
    let sections = try #require(WorkoutTemplate.named("Tabata 4×40/20")).sections
    #expect(sections.map(\.kind) == [.warmUp, .effort, .recovery, .repeats(4), .coolDown])
  }

  @Test func needsTwoFullRepeatsToMakeASet() throws {
    // Three blocks at rising targets, with the same recovery between them.
    let sections = try #require(WorkoutTemplate.named("Threshold waves 3×12")).sections
    #expect(
      sections.map(\.kind) == [.warmUp, .effort, .recovery, .effort, .recovery, .effort, .coolDown])
  }

  @Test func leavesAnEasyWorkoutAsItsSteps() throws {
    let template = try #require(WorkoutTemplate.named("Long endurance 90"))
    #expect(template.sections.map(\.kind) == [.effort, .effort, .effort])
  }

  @Test func coversEveryStepOfEveryLibraryWorkout() {
    for template in WorkoutTemplate.library {
      let total = template.sections.reduce(0) { $0 + $1.duration }
      #expect(total == template.duration, "\(template.name)")
    }
  }

  @Test func measuresIntensityAndTimeInZones() throws {
    let template = WorkoutTemplate(
      name: "Test", category: .threshold,
      steps: [.init(duration: 1800, intensity: 0.5), .init(duration: 1800, intensity: 1)])
    #expect(template.averageIntensity == 0.75)
    #expect(abs(template.intensityFactor - 0.625.squareRoot()) < 1e-9)
    #expect(
      template.timeInZones == [
        .init(zone: .recovery, seconds: 1800), .init(zone: .threshold, seconds: 1800),
      ])
  }
}
