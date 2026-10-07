import Foundation

/// Time a workout spends in one power zone.
public struct WorkoutZoneTime: Equatable, Identifiable, Sendable {
  public var zone: PowerZone
  public var seconds: TimeInterval
  public var id: PowerZone { zone }
}

extension WorkoutTemplate {
  /// Average target power as a fraction of FTP.
  public var averageIntensity: Double {
    steps.reduce(0) { $0 + $1.duration * $1.intensity } / max(duration, 1)
  }

  /// Intensity factor, as `stressScore` counts it: 1 for an hour at FTP.
  public var intensityFactor: Double {
    (steps.reduce(0) { $0 + $1.duration * $1.intensity * $1.intensity } / max(duration, 1))
      .squareRoot()
  }

  /// Time in each zone the workout visits, easiest first.
  public var timeInZones: [WorkoutZoneTime] {
    let seconds = Dictionary(grouping: steps, by: \.zone).mapValues {
      $0.reduce(0) { $0 + $1.duration }
    }
    return PowerZone.allCases.compactMap { zone in
      seconds[zone].map { WorkoutZoneTime(zone: zone, seconds: $0) }
    }
  }
}
