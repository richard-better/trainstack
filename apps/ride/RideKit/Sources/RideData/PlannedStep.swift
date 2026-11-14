import Foundation

public struct PlannedStep: Hashable, Codable, Sendable {
  public var duration: TimeInterval
  public var target: PlannedTarget?
  public var cadence: TargetLevel?
  public var name: String?
  public var notes: String?
  public var cues: [PlannedCue]

  public init(
    duration: TimeInterval, target: PlannedTarget?, cadence: TargetLevel? = nil,
    name: String? = nil, notes: String? = nil, cues: [PlannedCue] = []
  ) {
    self.duration = duration
    self.target = target
    self.cadence = cadence
    self.name = name
    self.notes = notes
    self.cues = cues
  }

  public func resolved(ftp: Int) -> Workout.Step {
    Workout.Step(
      duration: duration, target: target?.resolved(ftp: ftp), cadence: cadence, name: name,
      notes: notes, cues: cues)
  }
}
