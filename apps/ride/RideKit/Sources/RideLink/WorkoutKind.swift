#if canImport(HealthKit)
  import HealthKit

  /// The workout the watch records for a ride, as Health shows it.
  public enum WorkoutKind {
    public static var configuration: HKWorkoutConfiguration {
      let configuration = HKWorkoutConfiguration()
      configuration.activityType = .cycling
      configuration.locationType = .indoor
      return configuration
    }
  }
#endif
