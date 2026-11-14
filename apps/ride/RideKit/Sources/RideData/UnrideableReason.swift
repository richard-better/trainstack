public enum UnrideableReason: Error, Hashable, Sendable {
  case sport(TrainStackWorkout.Sport)
  case paceTargets
  case distanceSteps
  case rampOnALapStep
  case repeatCueAcrossALapStep
  case targetOutOfReach
  case tooManySteps
  case stepTooLong
  case stepWithoutLength
  case unknownUnit(String)
  case unknownKind(of: String, named: String)

  public var explanation: String {
    switch self {
    case .sport(let sport):
      "A \(sport.rawValue) workout. Ride plays cycling workouts on a trainer."
    case .paceTargets:
      "It sets pace targets, and a trainer holds power, not pace."
    case .distanceSteps:
      "It has steps measured in distance, and Ride plays steps measured in time."
    case .rampOnALapStep:
      "It ramps over a lap-button step, which has no length to ramp across."
    case .repeatCueAcrossALapStep:
      "It has a cue over a repeat with a lap-button step, so its time in the repeat is unknown."
    case .targetOutOfReach:
      "It has a target no rider or trainer can hold, or a range whose low end is above its high end."
    case .stepTooLong:
      "It has a step longer than a day."
    case .stepWithoutLength:
      "It has a step that lasts no time at all."
    case .tooManySteps:
      "It has more than \(TrainStackWorkout.mostSteps) steps once its repeats are counted out."
    case .unknownUnit(let unit):
      "It uses a unit, \(unit), that this version of Ride does not know. Update Ride to ride it."
    case .unknownKind(let part, let name):
      "It has a \(part), \(name), that this version of Ride does not know. Update Ride to ride it."
    }
  }
}
