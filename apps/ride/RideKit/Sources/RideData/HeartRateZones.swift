import Foundation

/// Five heart rate zones, as fractions of maximum heart rate.
public enum HeartRateZone: Int, CaseIterable, Sendable {
  case recovery, aerobic, tempo, threshold, vo2Max

  public var name: String {
    switch self {
    case .recovery: "Recovery"
    case .aerobic: "Aerobic"
    case .tempo: "Tempo"
    case .threshold: "Threshold"
    case .vo2Max: "VO2 max"
    }
  }

  /// Lower bound of the zone as a fraction of maximum heart rate.
  private var lowerBound: Double {
    switch self {
    case .recovery: 0
    case .aerobic: 0.6
    case .tempo: 0.7
    case .threshold: 0.8
    case .vo2Max: 0.9
    }
  }

  public static func zone(heartRate: Int, maxHeartRate: Int) -> HeartRateZone {
    let fraction = Double(heartRate) / Double(maxHeartRate)
    return allCases.last { fraction >= $0.lowerBound } ?? .recovery
  }
}

public struct ZoneShare: Equatable, Sendable {
  public var zone: HeartRateZone
  public var seconds: TimeInterval
  /// Share of the time spent in any zone, from 0 to 1.
  public var fraction: Double
}

extension RideRecording {
  /// Time spent in each heart rate zone, in zone order. Empty when the ride has no heart rate.
  ///
  /// Each sample counts until the next one, but a gap longer than `maxSampleGap` is a pause and
  /// does not count.
  public func heartRateZones(maxHeartRate: Int, maxSampleGap: TimeInterval = 5) -> [ZoneShare] {
    var seconds = [TimeInterval](repeating: 0, count: HeartRateZone.allCases.count)
    for (sample, next) in zip(samples, samples.dropFirst()) {
      guard let heartRate = sample.heartRate else { continue }
      let duration = next.elapsed - sample.elapsed
      guard duration > 0, duration <= maxSampleGap else { continue }
      seconds[HeartRateZone.zone(heartRate: heartRate, maxHeartRate: maxHeartRate).rawValue] +=
        duration
    }
    let total = seconds.reduce(0, +)
    guard total > 0 else { return [] }
    return HeartRateZone.allCases.map {
      ZoneShare(zone: $0, seconds: seconds[$0.rawValue], fraction: seconds[$0.rawValue] / total)
    }
  }
}
