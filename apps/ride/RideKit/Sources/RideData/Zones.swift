import Foundation

/// One zone of a `ZoneSet`, in whole bpm or watts.
public struct Zone: Hashable, Sendable {
  /// Position in the set, from 0.
  public var index: Int
  /// The zone's number, such as 2 or 5a.
  public var label: String
  public var name: String
  /// The lowest value in the zone: 0 for the first zone.
  public var lowerLimit: Int
  /// The highest value in the zone, or nil for the last zone, which has no top.
  public var upperLimit: Int?
}

/// Contiguous zones that cover every value from 0 up, with no gaps or overlaps.
public struct ZoneSet: Equatable, Sendable {
  public let zones: [Zone]

  /// Zones from `model` with the given tops. Nil unless there is one limit per zone but the last,
  /// and each zone holds at least one value.
  public init?(model: ZoneModel, upperLimits: [Int]) {
    guard upperLimits.count == model.zoneCount - 1, Self.isValid(upperLimits) else { return nil }
    zones = model.zoneNames.indices.map { index in
      Zone(
        index: index, label: model.zoneLabels[index], name: model.zoneNames[index],
        lowerLimit: index == 0 ? 0 : upperLimits[index - 1] + 1,
        upperLimit: index < upperLimits.count ? upperLimits[index] : nil)
    }
  }

  public var upperLimits: [Int] { zones.compactMap(\.upperLimit) }

  public func zone(containing value: Int) -> Zone {
    zones.last { value >= $0.lowerLimit } ?? zones[0]
  }

  /// The tops after moving zone `index`'s top to `limit`, so the next zone starts just above it.
  /// Nil when that would leave a zone empty.
  public func upperLimits(settingZone index: Int, upperLimitTo limit: Int) -> [Int]? {
    var limits = upperLimits
    guard limits.indices.contains(index) else { return nil }
    limits[index] = limit
    return Self.isValid(limits) ? limits : nil
  }

  private static func isValid(_ upperLimits: [Int]) -> Bool {
    zip([-1] + upperLimits, upperLimits).allSatisfy { $0 < $1 }
  }
}

public struct ZoneShare: Equatable, Sendable {
  public var zone: Zone
  public var seconds: TimeInterval
  /// Share of the time spent in any zone, from 0 to 1.
  public var fraction: Double
}

extension RideRecording {
  /// Time spent in each zone, in zone order. Empty when the ride did not record `metric`.
  ///
  /// Each sample counts until the next one, but a gap longer than `maxSampleGap` is a pause and
  /// does not count.
  public func timeInZones(
    _ zones: ZoneSet, of metric: ZoneMetric, maxSampleGap: TimeInterval = 5
  ) -> [ZoneShare] {
    let value: KeyPath<Sample, Int?> =
      switch metric {
      case .heartRate: \.heartRate
      case .power: \.power
      }
    var seconds = [TimeInterval](repeating: 0, count: zones.zones.count)
    for (sample, next) in zip(samples, samples.dropFirst()) {
      guard let value = sample[keyPath: value] else { continue }
      let duration = next.elapsed - sample.elapsed
      guard duration > 0, duration <= maxSampleGap else { continue }
      seconds[zones.zone(containing: value).index] += duration
    }
    let total = seconds.reduce(0, +)
    guard total > 0 else { return [] }
    return zones.zones.map {
      ZoneShare(zone: $0, seconds: seconds[$0.index], fraction: seconds[$0.index] / total)
    }
  }
}
