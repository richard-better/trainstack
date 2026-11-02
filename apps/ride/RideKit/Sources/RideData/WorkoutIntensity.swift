import Foundation

public struct WorkoutZoneTime: Equatable, Identifiable, Sendable {
  public var zone: PowerZone
  public var seconds: TimeInterval
  public var id: PowerZone { zone }
}

extension WorkoutTemplate {
  public var averageIntensity: Double {
    steps.reduce(0) { $0 + $1.duration * $1.intensity } / max(duration, 1)
  }

  public var intensityFactor: Double {
    (steps.reduce(0) { $0 + $1.duration * $1.intensity * $1.intensity } / max(duration, 1))
      .squareRoot()
  }

  public var timeInZones: [WorkoutZoneTime] {
    let seconds = Dictionary(grouping: steps, by: \.zone).mapValues {
      $0.reduce(0) { $0 + $1.duration }
    }
    return PowerZone.allCases.compactMap { zone in
      seconds[zone].map { WorkoutZoneTime(zone: zone, seconds: $0) }
    }
  }
}
