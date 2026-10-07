import Foundation

public struct ZoneShare<Zone: Hashable & Sendable>: Equatable, Sendable {
  public var zone: Zone
  public var seconds: TimeInterval
  /// Share of the time spent in any zone, from 0 to 1.
  public var fraction: Double
}

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

/// Six power zones, as fractions of functional threshold power (FTP).
public enum PowerZone: Int, CaseIterable, Sendable {
  case recovery, endurance, tempo, threshold, vo2Max, anaerobic

  public var name: String {
    switch self {
    case .recovery: "Recovery"
    case .endurance: "Endurance"
    case .tempo: "Tempo"
    case .threshold: "Threshold"
    case .vo2Max: "VO2 max"
    case .anaerobic: "Anaerobic"
    }
  }

  /// Lower bound of the zone as a fraction of FTP.
  private var lowerBound: Double {
    switch self {
    case .recovery: 0
    case .endurance: 0.55
    case .tempo: 0.75
    case .threshold: 0.90
    case .vo2Max: 1.05
    case .anaerobic: 1.20
    }
  }

  public static func zone(power: Int, ftp: Int) -> PowerZone {
    let fraction = Double(power) / Double(ftp)
    return allCases.last { fraction >= $0.lowerBound } ?? .recovery
  }
}

extension RideRecording {
  /// Time spent in each heart rate zone, in zone order. Empty when the ride has no heart rate.
  ///
  /// Each sample counts until the next one, but a gap longer than `maxSampleGap` is a pause and
  /// does not count.
  public func heartRateZones(
    maxHeartRate: Int, maxSampleGap: TimeInterval = 5
  ) -> [ZoneShare<HeartRateZone>] {
    zoneShares(maxSampleGap: maxSampleGap) { sample in
      sample.heartRate.map { HeartRateZone.zone(heartRate: $0, maxHeartRate: maxHeartRate) }
    }
  }

  /// Time spent in each power zone, in zone order. Empty when the ride has no power.
  public func powerZones(ftp: Int, maxSampleGap: TimeInterval = 5) -> [ZoneShare<PowerZone>] {
    zoneShares(maxSampleGap: maxSampleGap) { sample in
      sample.power.map { PowerZone.zone(power: $0, ftp: ftp) }
    }
  }

  private func zoneShares<Zone: CaseIterable & Hashable & Sendable>(
    maxSampleGap: TimeInterval, zone: (Sample) -> Zone?
  ) -> [ZoneShare<Zone>] {
    var seconds: [Zone: TimeInterval] = [:]
    for (sample, next) in zip(samples, samples.dropFirst()) {
      guard let zone = zone(sample) else { continue }
      let duration = next.elapsed - sample.elapsed
      guard duration > 0, duration <= maxSampleGap else { continue }
      seconds[zone, default: 0] += duration
    }
    let total = seconds.values.reduce(0, +)
    guard total > 0 else { return [] }
    return Zone.allCases.map {
      let zoneSeconds = seconds[$0] ?? 0
      return ZoneShare(zone: $0, seconds: zoneSeconds, fraction: zoneSeconds / total)
    }
  }
}
