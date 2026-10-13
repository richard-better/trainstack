import Foundation

extension RideRecording {
  /// Normalized power: the 30 second rolling average of power, averaged in a way that counts hard
  /// efforts for more than their share of the time. Nil for rides under 30 seconds.
  public func normalizedPower() -> Int? {
    let window = 30
    let perSecond = powerPerSecond()
    guard perSecond.count >= window else { return nil }
    var prefix = [Int](repeating: 0, count: perSecond.count + 1)
    for (index, power) in perSecond.enumerated() { prefix[index + 1] = prefix[index] + power }
    let averages = (window...perSecond.count).map { Double(prefix[$0] - prefix[$0 - window]) / 30 }
    let meanOfFourthPowers = averages.map { pow($0, 4) }.reduce(0, +) / Double(averages.count)
    return Int(pow(meanOfFourthPowers, 0.25).rounded())
  }

  /// Intensity factor: normalized power as a share of FTP, 1 for riding at FTP. Nil for rides
  /// under 30 seconds.
  public func intensityFactor(ftp: Int) -> Double? {
    guard ftp > 0, let normalized = normalizedPower() else { return nil }
    return Double(normalized) / Double(ftp)
  }

  /// Training stress score: 100 for an hour at FTP. Nil for rides under 30 seconds.
  public func trainingStressScore(ftp: Int) -> Int? {
    guard let intensity = intensityFactor(ftp: ftp) else { return nil }
    return Int((summary.duration * intensity * intensity / 3600 * 100).rounded())
  }

  /// The work done, in kilojoules: each sample's power over the time until the next one. A gap
  /// longer than `maxSampleGap` is a pause and does not count, as in `timeInZones`. Nil for a
  /// ride without power.
  public func work(maxSampleGap: TimeInterval = 5) -> Int? {
    guard hasPower else { return nil }
    var joules = 0.0
    for (sample, next) in zip(samples, samples.dropFirst()) {
      guard let power = sample.power else { continue }
      let duration = next.elapsed - sample.elapsed
      guard duration > 0, duration <= maxSampleGap else { continue }
      joules += Double(power) * duration
    }
    return Int((joules / 1000).rounded())
  }
}
