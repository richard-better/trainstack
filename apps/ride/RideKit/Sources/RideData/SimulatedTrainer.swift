import Foundation

/// A pretend trainer and heart rate strap that ride along with a session, for previews and for
/// trying the player without hardware. The same seed gives the same ride.
public struct SimulatedTrainer: Sendable {
  private var random: UInt64
  private var heartRate: Double = 90

  public init(seed: UInt64 = 17) {
    random = seed
  }

  /// The next reading, `duration` seconds after the last, for a rider following `session`.
  public mutating func reading(for session: RideSession, after duration: TimeInterval)
    -> TrainerReading
  {
    if session.isPaused {
      return TrainerReading(
        power: 0, cadence: 0, heartRate: Int(drift(by: duration, to: 85)),
        heartRateSource: .simulated, speed: 0)
    }
    let effort =
      switch session.mode {
      case .erg: Double(session.targetPower ?? 120)
      case .slope: 130 + session.grade * 18
      case .level: 60 + Double(session.level) * 15
      }
    var power = effort + (next() - 0.5) * 16
    // Now and then the rider eases off for a moment, as real riders do.
    if next() < 0.02 { power -= 50 + next() * 40 }
    power = max(0, power)
    let heartRate = drift(by: duration, to: 70 + effort * 0.45)
    return TrainerReading(
      power: Int(power.rounded()), cadence: Int((88 + (next() - 0.5) * 6).rounded()),
      heartRate: Int(heartRate.rounded()), heartRateSource: .simulated,
      speed: Self.speed(power: power))
  }

  /// Flat-road speed in metres per second, mostly fighting air resistance.
  static func speed(power: Double) -> Double {
    pow(max(power, 0) / 0.32, 1.0 / 3)
  }

  /// Moves heart rate toward `target` the way it lags behind effort.
  private mutating func drift(by duration: TimeInterval, to target: Double) -> Double {
    heartRate += (target - heartRate) * min(1, 0.06 * duration) + (next() - 0.5) * 2
    return heartRate
  }

  /// A uniform value in 0..<1 from a small linear congruential generator.
  private mutating func next() -> Double {
    random = random &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
    return Double(random >> 11) / Double(1 << 53)
  }
}
