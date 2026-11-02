import Foundation
import RideData

public struct SimulatedRider: Sendable {
  public let physiology: RiderPhysiology
  public private(set) var wPrimeBalanceJoules: Double
  public private(set) var crackedIntervals: Set<Int> = []
  private var heartRate: Double
  private var random: UInt64

  public init(_ physiology: RiderPhysiology, seed: UInt64 = 17) {
    self.physiology = physiology
    wPrimeBalanceJoules = physiology.wPrimeJoules
    heartRate = physiology.restingHeartRate + 20
    random = seed
  }

  static let crackedShareOfCriticalPower = 0.5
  static let slopeEffortShareOfCriticalPower = 0.7
  static let slopeEffortSharePerGradePercent = 0.03
  static let levelEffortShareOfCriticalPower = 0.45
  static let levelEffortSharePerLevel = 0.03
  static let heartRateTimeConstantSeconds = 30.0

  public mutating func reading(for session: RideSession, after seconds: TimeInterval)
    -> TrainerReading
  {
    guard !session.isPaused, let interval = session.currentInterval else {
      return TrainerReading(
        power: 0, cadence: 0, heartRate: Int(settleHeartRate(atPower: 0, over: seconds)),
        heartRateSource: .simulated)
    }
    let cracked = crackedIntervals.contains(interval.index)
    let asked = cracked ? crackedPower : askedPower(in: session)
    let power = max(0, asked + (nextUniform() - 0.5) * 10)
    spendOrRecoverWPrime(atPower: power, over: seconds)
    if wPrimeBalanceJoules <= 0 { crackedIntervals.insert(interval.index) }
    let cadence = cracked ? 62 + (nextUniform() - 0.5) * 8 : 90 + (nextUniform() - 0.5) * 6
    return TrainerReading(
      power: Int(power.rounded()), cadence: Int(cadence.rounded()),
      heartRate: Int(settleHeartRate(atPower: power, over: seconds).rounded()),
      heartRateSource: .simulated)
  }

  public var hasCracked: Bool { !crackedIntervals.isEmpty }

  private var crackedPower: Double {
    physiology.criticalPowerWatts * Self.crackedShareOfCriticalPower
  }

  private func askedPower(in session: RideSession) -> Double {
    let criticalPower = physiology.criticalPowerWatts
    return switch session.mode {
    case .erg: Double(session.targetPower ?? 0)
    case .slope:
      criticalPower
        * (Self.slopeEffortShareOfCriticalPower
          + session.slopeGradePercent * Self.slopeEffortSharePerGradePercent)
    case .level:
      criticalPower
        * (Self.levelEffortShareOfCriticalPower
          + Double(session.level) * Self.levelEffortSharePerLevel)
    }
  }

  private mutating func spendOrRecoverWPrime(atPower power: Double, over seconds: TimeInterval) {
    let criticalPower = physiology.criticalPowerWatts
    if power > criticalPower {
      wPrimeBalanceJoules -= (power - criticalPower) * seconds
    } else {
      let recoveryTimeConstant = 546 * exp(-0.01 * (criticalPower - power)) + 316
      let unspent = physiology.wPrimeJoules - wPrimeBalanceJoules
      wPrimeBalanceJoules += unspent * (1 - exp(-seconds / recoveryTimeConstant))
    }
  }

  private mutating func settleHeartRate(atPower power: Double, over seconds: TimeInterval)
    -> Double
  {
    let effort = min(1.2, power / physiology.criticalPowerWatts)
    let reserve = physiology.maxHeartRate - physiology.restingHeartRate
    let steady = min(
      physiology.maxHeartRate, physiology.restingHeartRate + reserve * (0.25 + 0.65 * effort))
    heartRate +=
      (steady - heartRate) * min(1, seconds / Self.heartRateTimeConstantSeconds)
      + (nextUniform() - 0.5)
    return heartRate
  }

  private mutating func nextUniform() -> Double {
    random = random &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
    return Double(random >> 11) / Double(1 << 53)
  }
}
