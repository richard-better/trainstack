import Foundation

public struct TrainingLoad: Equatable, Identifiable, Sendable {
  public static let fitnessDays = 42.0
  public static let fatigueDays = 7.0

  public var date: Date
  public var stress: Double
  public var fitness: Double
  public var fatigue: Double

  public var form: Double { fitness - fatigue }

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

extension PowerZone {
  public var intensity: Intensity {
    switch self {
    case .recovery, .endurance: .easy
    case .tempo, .threshold: .moderate
    case .vo2Max, .anaerobic: .hard
    }
  }
}

extension Sequence where Element == RideRecording {
  public func stressByDay(
    calendar: Calendar = .current, ftp: (RideRecording) -> Int?
  ) -> [Date: Double] {
    reduce(into: [:]) { result, ride in
      guard let ftp = ftp(ride), let stress = ride.trainingStressScore(ftp: ftp) else { return }
      result[calendar.startOfDay(for: ride.startDate), default: 0] += Double(stress)
    }
  }
}

extension Sequence where Element == [ZoneShare] {
  public func combined() -> [ZoneShare] {
    var zones: [ZoneKey: Zone] = [:]
    var order: [ZoneKey] = []
    var seconds: [ZoneKey: TimeInterval] = [:]
    for shares in self {
      for share in shares {
        let key = ZoneKey(label: share.zone.label, name: share.zone.name)
        if zones[key] == nil {
          zones[key] = share.zone
          order.append(key)
        }
        seconds[key, default: 0] += share.seconds
      }
    }
    let total = seconds.values.reduce(0, +)
    guard total > 0 else { return [] }
    return order.compactMap { key in
      zones[key].map {
        ZoneShare(zone: $0, seconds: seconds[key] ?? 0, fraction: (seconds[key] ?? 0) / total)
      }
    }
  }
}

private struct ZoneKey: Hashable {
  let label: String
  let name: String
}

extension TrainingLoad {
  public var id: Date { date }
}
