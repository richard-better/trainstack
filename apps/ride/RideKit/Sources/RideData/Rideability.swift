public enum Rideability: Hashable, Sendable {
  case rideable(PlannedWorkout)
  case unrideable(UnrideableReason)

  public var planned: PlannedWorkout? {
    guard case .rideable(let planned) = self else { return nil }
    return planned
  }

  public var reason: UnrideableReason? {
    guard case .unrideable(let reason) = self else { return nil }
    return reason
  }
}
