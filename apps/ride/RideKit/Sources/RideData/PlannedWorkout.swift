import Foundation

public struct PlannedWorkout: Hashable, Codable, Sendable {
  public var name: String
  public var category: PowerZone?
  public var about: String
  public var steps: [PlannedStep]
  public var rampSteps: Range<Int>?

  public init(
    name: String, category: PowerZone?, about: String = "", steps: [PlannedStep],
    rampSteps: Range<Int>? = nil
  ) {
    self.name = name
    self.category = category
    self.about = about
    self.steps = steps
    self.rampSteps = rampSteps
  }

  public var duration: TimeInterval { steps.reduce(0) { $0 + $1.duration } }

  public func workout(ftp: Int) -> Workout {
    Workout(name: name, steps: steps.map { $0.resolved(ftp: ftp) }, rampSteps: rampSteps)
  }
}

extension WorkoutTemplate {
  public var planned: PlannedWorkout {
    PlannedWorkout(
      name: name, category: category, about: about,
      steps: steps.enumerated().map { index, step in
        PlannedStep(
          duration: step.duration, target: .shareOfFTP(.constant(step.intensity)),
          cues: cues(onStep: index))
      })
  }
}
