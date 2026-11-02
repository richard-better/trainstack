import Foundation

public struct SimulatedTrainer: Sendable {
  private var random: UInt64
  private var heartRate: Double = 90

  public init(seed: UInt64 = 17) {
    random = seed
  }

  public mutating func reading(for session: RideSession, after duration: TimeInterval)
    -> TrainerReading
  {
    if session.isPaused {
      return TrainerReading(
        power: 0, cadence: 0, heartRate: Int(driftHeartRate(toward: 85, over: duration)),
        heartRateSource: .simulated)
    }
    let effort =
      switch session.mode {
      case .erg: Double(session.targetPower ?? 120)
      case .slope: 130 + session.slopeGradePercent * 18
      case .level: 60 + Double(session.level) * 15
      }
    var power = effort + (nextUniform() - 0.5) * 16
    power -= occasionalEaseOff()
    power = max(0, power)
    let heartRate = driftHeartRate(toward: 70 + effort * 0.45, over: duration)
    return TrainerReading(
      power: Int(power.rounded()), cadence: Int((88 + (nextUniform() - 0.5) * 6).rounded()),
      heartRate: Int(heartRate.rounded()), heartRateSource: .simulated)
  }

  private mutating func occasionalEaseOff() -> Double {
    nextUniform() < 0.02 ? 50 + nextUniform() * 40 : 0
  }

  private mutating func driftHeartRate(toward target: Double, over duration: TimeInterval)
    -> Double
  {
    heartRate += (target - heartRate) * min(1, 0.06 * duration) + (nextUniform() - 0.5) * 2
    return heartRate
  }

  private mutating func nextUniform() -> Double {
    random = random &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
    return Double(random >> 11) / Double(1 << 53)
  }
}
