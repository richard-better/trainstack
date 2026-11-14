import RideData

protocol HealthWorkoutStore {
  func workouts() async throws -> [HealthWorkoutEntry]
  func activity(of id: String) async throws -> HealthActivity?
}
