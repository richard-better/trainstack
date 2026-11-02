#if canImport(HealthKit)
  import HealthKit

  public enum WorkoutKind {
    public static var configuration: HKWorkoutConfiguration {
      let configuration = HKWorkoutConfiguration()
      configuration.activityType = .cycling
      configuration.locationType = .indoor
      return configuration
    }
  }
#endif
