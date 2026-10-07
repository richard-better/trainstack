import Foundation

/// Fitness, fatigue and form on one day, from the training stress of the days before it.
///
/// Fitness (chronic training load) is the average daily stress over about six weeks, fatigue
/// (acute training load) over about a week, both weighted toward recent days. Form is fitness
/// minus fatigue: positive when rested, negative while building.
public struct TrainingLoad: Equatable, Sendable {
  public static let fitnessDays = 42.0
  public static let fatigueDays = 7.0

  /// The start of the day.
  public var date: Date
  /// The stress ridden that day.
  public var stress: Double
  public var fitness: Double
  public var fatigue: Double

  public var form: Double { fitness - fatigue }

  /// One entry per day from `start` through `end`, starting from no load. Stress on days outside
  /// the range is ignored, so start early enough for the load to build up.
  public static func daily(
    stress: [Date: Double], from start: Date, through end: Date, calendar: Calendar = .current
  ) -> [TrainingLoad] {
    var day = calendar.startOfDay(for: start)
    let last = calendar.startOfDay(for: end)
    var fitness = 0.0
    var fatigue = 0.0
    var result: [TrainingLoad] = []
    while day <= last {
      let today = stress[day] ?? 0
      fitness += (today - fitness) / fitnessDays
      fatigue += (today - fatigue) / fatigueDays
      result.append(.init(date: day, stress: today, fitness: fitness, fatigue: fatigue))
      guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
      day = next
    }
    return result
  }
}

/// How hard training felt, in three bands of zones.
public enum Intensity: Int, CaseIterable, Sendable {
  case easy, moderate, hard

  public var name: String {
    switch self {
    case .easy: "Easy"
    case .moderate: "Moderate"
    case .hard: "Hard"
    }
  }
}

extension PowerZone {
  public var intensity: Intensity {
    switch self {
    case .recovery, .endurance: .easy
    case .tempo, .threshold: .moderate
    case .vo2Max, .anaerobic: .hard
    }
  }
}

extension HeartRateZone {
  public var intensity: Intensity {
    switch self {
    case .recovery, .aerobic: .easy
    case .tempo, .threshold: .moderate
    case .vo2Max: .hard
    }
  }
}

extension Sequence where Element == RideRecording {
  /// Training stress per day, keyed by the start of the day. Rides without power are left out.
  public func stressByDay(ftp: Int, calendar: Calendar = .current) -> [Date: Double] {
    reduce(into: [:]) { result, ride in
      guard let stress = ride.trainingStressScore(ftp: ftp) else { return }
      result[calendar.startOfDay(for: ride.startDate), default: 0] += Double(stress)
    }
  }
}

extension Sequence {
  /// Several rides' zone times added up, in zone order. Empty when none of them had any.
  public func combined<Zone>() -> [ZoneShare<Zone>] where Element == [ZoneShare<Zone>] {
    var order: [Zone] = []
    var seconds: [Zone: TimeInterval] = [:]
    for shares in self {
      for share in shares {
        if seconds[share.zone] == nil { order.append(share.zone) }
        seconds[share.zone, default: 0] += share.seconds
      }
    }
    let total = seconds.values.reduce(0, +)
    guard total > 0 else { return [] }
    return order.map {
      ZoneShare(zone: $0, seconds: seconds[$0] ?? 0, fraction: (seconds[$0] ?? 0) / total)
    }
  }
}
