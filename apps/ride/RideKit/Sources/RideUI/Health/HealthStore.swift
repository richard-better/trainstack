import Foundation
import RideData

protocol HealthStore {
  func workouts() async throws -> [HealthWorkoutEntry]
  func activity(of id: String) async throws -> HealthActivity?
  func measuredDays(_ days: [SettingDay], calendar: Calendar) async throws -> [MeasuredDay]
}
