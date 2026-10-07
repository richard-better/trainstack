import Foundation

/// One zone of a `ZoneSet`, in whole bpm, watts or seconds of pace.
public struct Zone: Hashable, Sendable {
  /// Position in the set, from 0 for the easiest.
  public var index: Int
  /// The zone's number, such as 2 or 5a.
  public var label: String
  public var name: String
  /// The easiest value in the zone, or nil for the first zone, which takes everything easier.
  public var start: Int?
  /// The hardest value in the zone, or nil for the last zone, which takes everything harder.
  public var end: Int?
}

/// Contiguous zones from easiest to hardest that cover every value, with no gaps or overlaps.
/// Values rise through the zones, except pace, where they fall.
public struct ZoneSet: Equatable, Sendable {
  public let zones: [Zone]
  public let isDescending: Bool

  /// Zones from `model` that end at `limits`. Nil unless there is one limit per zone but the
  /// last, and each zone holds at least one value.
  public init?(model: ZoneModel, limits: [Int]) {
    let isDescending = model.metric.isDescending
    guard limits.count == model.zoneCount - 1, Self.isValid(limits, descending: isDescending)
    else { return nil }
    let step = isDescending ? -1 : 1
    self.isDescending = isDescending
    zones = model.zoneNames.indices.map { index in
      Zone(
        index: index, label: model.zoneLabels[index], name: model.zoneNames[index],
        start: index == 0 ? nil : limits[index - 1] + step,
        end: index < limits.count ? limits[index] : nil)
    }
  }

  /// Where each zone but the last ends.
  public var limits: [Int] { zones.compactMap(\.end) }

  public func zone(containing value: Int) -> Zone {
    zones.last { zone in
      guard let start = zone.start else { return true }
      return isDescending ? value <= start : value >= start
    } ?? zones[0]
  }

  /// The limits after moving the end of zone `index` to `limit`, so the next zone starts just
  /// past it. Nil when that would leave a zone empty.
  public func limits(settingZone index: Int, endTo limit: Int) -> [Int]? {
    var limits = limits
    guard limits.indices.contains(index) else { return nil }
    limits[index] = limit
    return Self.isValid(limits, descending: isDescending) ? limits : nil
  }

  /// Rising from 0, or for pace falling and staying above a second.
  private static func isValid(_ limits: [Int], descending: Bool) -> Bool {
    descending
      ? zip(limits, limits.dropFirst() + [1]).allSatisfy { $0 > $1 }
      : zip([-1] + limits, limits).allSatisfy { $0 < $1 }
  }
}

public struct ZoneShare: Equatable, Sendable {
  public var zone: Zone
  public var seconds: TimeInterval
  /// Share of the time spent in any zone, from 0 to 1.
  public var fraction: Double
}

extension RideRecording {
  /// Time spent in each zone, in zone order. Empty when the ride did not record `metric`, or for
  /// pace, when it has no sport with a pace.
  ///
  /// Each sample counts until the next one, but a gap longer than `maxSampleGap` is a pause and
  /// does not count. Pace is only counted while moving.
  public func timeInZones(
    _ zones: ZoneSet, of metric: ZoneMetric, maxSampleGap: TimeInterval = 5
  ) -> [ZoneShare] {
    let value: (Sample) -> Int?
    switch metric {
    case .heartRate: value = \.heartRate
    case .power: value = \.power
    case .pace:
      guard let distance = sport?.paceDistance else { return [] }
      value = { sample in
        sample.speed.flatMap { $0 > 0 ? Int((distance / $0).rounded()) : nil }
      }
    }
    var seconds = [TimeInterval](repeating: 0, count: zones.zones.count)
    for (sample, next) in zip(samples, samples.dropFirst()) {
      guard let value = value(sample) else { continue }
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
