import Foundation

extension RideRecording {
  public func timeInZones(_ zones: ZoneSet, of metric: ZoneMetric) -> [ZoneShare] {
    let value: (Sample) -> Int?
    switch metric {
    case .heartRate: value = \.heartRate
    case .power: value = \.power
    case .pace:
      guard let paceDistanceMetres = sport?.paceDistanceMetres else { return [] }
      value = { sample in
        sample.speedMetresPerSecond.flatMap {
          $0 > 0 ? Int((paceDistanceMetres / $0).rounded()) : nil
        }
      }
    }
    var seconds = [TimeInterval](repeating: 0, count: zones.zones.count)
    for interval in heldIntervals {
      guard let value = value(samples[interval.sample]) else { continue }
      seconds[zones.zone(containing: value).index] += interval.duration
    }
    let total = seconds.reduce(0, +)
    guard total > 0 else { return [] }
    return zones.zones.map {
      ZoneShare(zone: $0, seconds: seconds[$0.index], fraction: seconds[$0.index] / total)
    }
  }
}
