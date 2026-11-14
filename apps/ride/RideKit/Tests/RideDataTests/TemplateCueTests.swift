import Foundation
import Testing

@testable import RideData

struct TemplateCueTests {
  @Test(arguments: WorkoutTemplate.library)
  func everyBundledWorkoutTalksTheRiderThroughItsSteps(_ template: WorkoutTemplate) {
    #expect(!template.cues.isEmpty)
    for cue in template.cues {
      #expect(template.steps.indices.contains(cue.step), "\(cue.text)")
      #expect(cue.at < template.steps[cue.step].duration, "\(cue.text)")
      #expect(cue.text.count <= 48, "\(cue.text) is too long to read from the bike")
    }
  }

  @Test func eachCuePlaysOnItsStep() {
    let planned = WorkoutTemplate.named("Threshold waves 3×12")!.planned
    #expect(planned.steps[2].cues == [PlannedCue(at: 0, text: "Wave 1: just under threshold")])
    #expect(planned.steps[6].cues.map(\.at) == [0, 360])
  }

  @Test func aFittedWorkoutKeepsTheTextOfTheStepsItKeeps() {
    let template = WorkoutTemplate.named("Long endurance 90")!
    let fitted = template.fitted(to: 45 * 60)
    #expect(
      fitted.cues.map(\.text) == [
        "Warm up easy", "Long and steady. Eat and drink every 20 minutes", "Cool down",
      ])
  }

  @Test func aWorkoutSavedWithoutTextStillReads() throws {
    let json = Data(
      #"{"name":"Old","category":1,"about":"","steps":[{"duration":60,"intensity":0.5}]}"#.utf8)
    let template = try JSONDecoder().decode(WorkoutTemplate.self, from: json)
    #expect(template.cues.isEmpty)
    #expect(template.planned.steps.first?.cues == [])
  }

  @Test func aCopyOfABuiltInCarriesItsText() {
    let copy = WorkoutTemplate.named("Recovery 30")!.trainStackWorkout
    guard case .step(let step) = copy.blocks[4] else {
      Issue.record("Recovery 30 starts with steps")
      return
    }
    #expect(
      step.cues == [TrainStackWorkout.Cue(at: .seconds(0), text: "The gentle peak. Still easy")])
  }
}
