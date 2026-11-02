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

  func powerPerSecond(maxSampleGap: TimeInterval = 5) -> [Int] {
    guard hasPower, let last = samples.last else { return [] }
    var result = [Int](repeating: 0, count: max(Int(last.elapsed) + 1, 0))
    for (index, sample) in samples.enumerated() {
      let first = Int(sample.elapsed)
      guard first >= 0, first < result.count else { continue }
      var end = first + 1
      if index + 1 < samples.count {
        let next = samples[index + 1].elapsed
        if next - sample.elapsed <= maxSampleGap { end = max(Int(next), end) }
      }
      for second in first..<min(end, result.count) { result[second] = sample.power ?? 0 }
    }
    return result
  }
}

extension PowerCurvePoint {
  public var id: TimeInterval { duration }
}
