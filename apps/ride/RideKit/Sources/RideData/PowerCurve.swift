import Foundation

public struct PowerCurvePoint: Equatable, Identifiable, Sendable {
  public var duration: TimeInterval
  public var power: Int
}

extension RideRecording {
  public static let powerCurveDurations: [TimeInterval] = [
    5, 15, 30, 60, 300, 600, 1200, 1800, 3600,
  ]

  public func powerCurve(durations: [TimeInterval] = powerCurveDurations) -> [PowerCurvePoint] {
    let perSecond = powerPerSecond()
    guard !perSecond.isEmpty else { return [] }
    var prefix = [Int](repeating: 0, count: perSecond.count + 1)
    for (index, power) in perSecond.enumerated() { prefix[index + 1] = prefix[index] + power }

    return durations.compactMap { duration in
      let window = Int(duration)
      guard window > 0, window <= perSecond.count else { return nil }
      let best = (window...perSecond.count).map { prefix[$0] - prefix[$0 - window] }.max() ?? 0
      return PowerCurvePoint(
        duration: duration, power: Int((Double(best) / Double(window)).rounded()))
    }
  }

  func powerPerSecond() -> [Int] {
    guard hasPower, let last = samples.last else { return [] }
    var result = [Int](repeating: 0, count: max(Int(last.elapsed) + 1, 0))
    func fill(_ sample: Int, from start: TimeInterval, to end: TimeInterval) {
      let first = Int(start)
      guard first >= 0, first < result.count else { return }
      let power = samples[sample].power ?? 0
      for second in first..<min(max(Int(end), first + 1), result.count) { result[second] = power }
    }
    let held = Dictionary(grouping: heldIntervals, by: \.sample)
    for (index, sample) in samples.enumerated() {
      if let intervals = held[index] {
        for interval in intervals { fill(index, from: interval.start, to: interval.end) }
      } else if !SamplingRule.isPaused(sample.elapsed, by: pauses) {
        fill(index, from: sample.elapsed, to: sample.elapsed)
      }
    }
    return result
  }
}

extension PowerCurvePoint {
  public var id: TimeInterval { duration }
}
