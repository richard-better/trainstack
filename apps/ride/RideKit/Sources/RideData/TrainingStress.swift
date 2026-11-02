import Foundation

extension RideRecording {
  static let normalizedPowerWindow = 30

  public func normalizedPower() -> Int? {
    let window = Self.normalizedPowerWindow
    let perSecond = powerPerSecond()
    guard perSecond.count >= window else { return nil }
    var prefix = [Int](repeating: 0, count: perSecond.count + 1)
    for (index, power) in perSecond.enumerated() { prefix[index + 1] = prefix[index] + power }
    let rollingAverages = (window...perSecond.count).map {
      Double(prefix[$0] - prefix[$0 - window]) / Double(window)
    }
    let meanOfFourthPowers =
      rollingAverages.map { pow($0, 4) }.reduce(0, +) / Double(rollingAverages.count)
    return Int(pow(meanOfFourthPowers, 0.25).rounded())
  }

  public func intensityFactor(ftp: Int) -> Double? {
    guard ftp > 0, let normalized = normalizedPower() else { return nil }
    return Double(normalized) / Double(ftp)
  }

  public func trainingStressScore(ftp: Int) -> Int? {
    guard let intensity = intensityFactor(ftp: ftp) else { return nil }
    let secondsInAnHour = 3600.0
    return Int((summary.duration * intensity * intensity / secondsInAnHour * 100).rounded())
  }

  public func workKilojoules(maxSampleGap: TimeInterval = 5) -> Int? {
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
