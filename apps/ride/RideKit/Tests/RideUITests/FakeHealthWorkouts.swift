import Foundation
import RideData

@testable import RideUI

final class FakeHealthWorkouts: HealthStore {
  struct Workout {
    let entry: HealthWorkoutEntry
    let activity: HealthActivity
  }

  var workouts: [Workout] = []
  var measured: [SettingDay: MeasuredDay] = [:]
  private(set) var read: [String] = []

  func add(
    _ id: String, sport: HealthSport = .running, endingAt end: Date, writtenByRide: Bool = false
  ) {
    let start = end.addingTimeInterval(-1800)
    let activity = HealthActivity(
      sport: sport, startDate: start, endDate: end,
      heartRate: stride(from: 0.0, through: 1800, by: 5).map {
        .init(date: start.addingTimeInterval($0), value: 140)
      })
    workouts.append(
      Workout(
        entry: HealthWorkoutEntry(id: id, endDate: end, writtenByRide: writtenByRide),
        activity: activity))
  }

  func file(of id: String) -> Data? {
    workouts.first { $0.entry.id == id }.map { FITEncoder.encode($0.activity) }
  }

  func workouts() async throws -> [HealthWorkoutEntry] { workouts.map(\.entry) }

  func measuredDays(_ days: [SettingDay], calendar: Calendar) async throws -> [MeasuredDay] {
    days.map {
      measured[$0]
        ?? MeasuredDay(day: $0, sleepSeconds: nil, restingHeartRateBpm: nil, hrvMs: nil)
    }
  }

  func activity(of id: String) async throws -> HealthActivity? {
    read.append(id)
    return workouts.first { $0.entry.id == id }?.activity
  }
}
