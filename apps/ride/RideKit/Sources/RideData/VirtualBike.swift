import Foundation

public struct VirtualBike: Equatable, Sendable {
  public let riderAndBikeMass: Double
  public private(set) var speedMetresPerSecond: Double

  static let dragAreaOnTheHoods = 0.32
  static let rollingResistance = 0.004
  static let seaLevelAirDensity = 1.225
  static let drivetrainEfficiency = 0.97
  static let gravity = 9.81
  static let bikeMass = 9.0
  static let longestIntegrationStep: TimeInterval = 0.25

  public init(riderWeight: Double, speedMetresPerSecond: Double = 0) {
    riderAndBikeMass = riderWeight + Self.bikeMass
    self.speedMetresPerSecond = max(0, speedMetresPerSecond)
  }

  @discardableResult
  public mutating func ride(power: Double, gradeFraction: Double, for duration: TimeInterval)
    -> Double
  {
    guard duration > 0 else { return 0 }
    let steps = (duration / Self.longestIntegrationStep).rounded(.up)
    let step = duration / steps
    let mass = riderAndBikeMass
    var distanceMetres = 0.0
    for _ in 0..<Int(steps) {
      let start = speedMetresPerSecond
      if speedMetresPerSecond == 0 {
        speedMetresPerSecond = max(0, -resistingForce(gradeFraction: gradeFraction)) / mass * step
      }
      let work =
        (Self.drivetrainEfficiency * max(0, power)
          - resistingForce(gradeFraction: gradeFraction) * speedMetresPerSecond) * step
      let energy = max(0, 0.5 * mass * speedMetresPerSecond * speedMetresPerSecond + work)
      speedMetresPerSecond = (2 * energy / mass).squareRoot()
      distanceMetres += (start + speedMetresPerSecond) / 2 * step
    }
    return distanceMetres
  }

  private func resistingForce(gradeFraction: Double) -> Double {
    let roadAngle = atan(gradeFraction)
    let speed = speedMetresPerSecond
    let drag = 0.5 * Self.seaLevelAirDensity * Self.dragAreaOnTheHoods * speed * speed
    let rolling = Self.rollingResistance * riderAndBikeMass * Self.gravity * cos(roadAngle)
    let climbing = riderAndBikeMass * Self.gravity * sin(roadAngle)
    return drag + rolling + climbing
  }
}
