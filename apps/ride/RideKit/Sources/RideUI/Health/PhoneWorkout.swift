#if os(iOS)
  import HealthKit
  import RideLink
  import os

  final class PhoneWorkout {
    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private let log = Logger(subsystem: "com.trainstackhq.ride", category: "health")

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
