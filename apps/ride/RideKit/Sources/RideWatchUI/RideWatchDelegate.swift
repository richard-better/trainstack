#if os(watchOS)
  import HealthKit
  import WatchKit

  /// Starts the workout when a ride starts on the phone, and picks one up after a relaunch.
  public final class RideWatchDelegate: NSObject, WKApplicationDelegate {
    public func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
      WorkoutRelay.shared.start(fromPhone: true)
    }

    public func handleActiveWorkoutRecovery() {
      Task { await WorkoutRelay.shared.recover() }
    }
  }
#endif
