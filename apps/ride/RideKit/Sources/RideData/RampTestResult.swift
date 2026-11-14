import Foundation

public struct RampTestResult: Equatable, Sendable {
  public let bestMinuteWatts: Int
  public let bestMinuteStart: TimeInterval
  public let ftp: Int
  public let maxHeartRate: Int?

  public init?(_ recording: RideRecording) {
    let perSecond = recording.powerPerSecond()
    let window = Int(RampTest.stepSeconds)
    guard perSecond.count >= window else { return nil }
    var sum = perSecond.prefix(window).reduce(0, +)
    var best = (sum: sum, start: 0)
    for end in window..<perSecond.count {
      sum += perSecond[end] - perSecond[end - window]
      if sum > best.sum { best = (sum, end - window + 1) }
    }
    guard best.sum > 0 else { return nil }
    bestMinuteWatts = Int((Double(best.sum) / Double(window)).rounded())
    bestMinuteStart = TimeInterval(best.start)
    ftp = Int((Double(bestMinuteWatts) * RampTest.bestMinuteShare).rounded())
    maxHeartRate = recording.summary.maxHeartRate
  }
}
