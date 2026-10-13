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

  /// The work done, in kilojoules: power over each second of the ride added up. Nil for a ride
  /// without power.
  public func work() -> Int? {
    let perSecond = powerPerSecond()
    guard !perSecond.isEmpty else { return nil }
    return Int((Double(perSecond.reduce(0, +)) / 1000).rounded())
  }
}
