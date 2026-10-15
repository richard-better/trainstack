#if os(iOS)
  import HealthKit
  import RideLink
  import os

  /// A workout session the iPhone or iPad runs itself while a ride is on and no Apple Watch is
  /// running one, so the system treats the ride as a workout. The ride is saved to Health from
  /// its recording by `HealthRides`, so the session collects nothing.
  final class PhoneWorkout {
    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private let log = Logger(subsystem: "com.trainstackhq.ride", category: "health")

    /// Starts the session, unless one is running or the rider has not let Ride save workouts.
    func start() {
      guard session == nil, HealthRides.shared.canSave else { return }
      do {
        let session = try HKWorkoutSession(
          healthStore: store, configuration: WorkoutKind.configuration)
        session.startActivity(with: .now)
        self.session = session
      } catch {
        log.error("Workout session not started: \(error.localizedDescription)")
      }
    }

    func end() {
      session?.end()
      session = nil
    }

    /// Ends a session left running when the app quit mid ride. A resumed ride starts its own.
    func endLeftOverSession() async {
      guard HKHealthStore.isHealthDataAvailable() else { return }
      do {
        try await store.recoverActiveWorkoutSession()?.end()
      } catch {
        log.error("Workout session not recovered: \(error.localizedDescription)")
      }
    }
  }
#endif
