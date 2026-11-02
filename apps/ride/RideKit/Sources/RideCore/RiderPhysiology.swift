import Foundation

public struct RiderPhysiology: Equatable, Sendable {
  public var criticalPowerWatts: Double
  public var wPrimeJoules: Double
  public var restingHeartRate: Double
  public var maxHeartRate: Double

  public init(
    criticalPowerWatts: Double, wPrimeJoules: Double, restingHeartRate: Double = 55,
    maxHeartRate: Double = 188
  ) {
    self.criticalPowerWatts = criticalPowerWatts
    self.wPrimeJoules = wPrimeJoules
    self.restingHeartRate = restingHeartRate
    self.maxHeartRate = maxHeartRate
  }

  public static func typical(ftp: Int) -> RiderPhysiology {
    RiderPhysiology(criticalPowerWatts: Double(ftp) * 1.03, wPrimeJoules: 18_000)
  }

  public static func population(ftp: Int) -> [RiderPhysiology] {
    let criticalPowerShareOfFTP = [0.97, 1.0, 1.03, 1.06]
    let wPrimes = [12_000.0, 16_000, 20_000, 24_000]
    return criticalPowerShareOfFTP.flatMap { share in
      wPrimes.map {
        RiderPhysiology(criticalPowerWatts: Double(ftp) * share, wPrimeJoules: $0)
      }
    }
  }
}
