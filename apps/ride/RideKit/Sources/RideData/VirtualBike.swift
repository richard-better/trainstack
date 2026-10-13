import Foundation

/// A bike and rider on a virtual road, moved along by the rider's power. Many trainers do not
/// report speed, and in ERG mode what they report depends on the gear rather than the effort,
/// so speed and distance come from this instead, as in Zwift and TrainerRoad.
///
/// Each step adds the work the rider puts in to the kinetic energy and takes away what air drag,
/// rolling resistance and the gradient cost, rather than jumping to the steady speed for the
/// power. So speed builds and fades with momentum, and a moment off the pedals barely shows.
public struct VirtualBike: Equatable, Sendable {
  /// Kilograms, rider and bike together.
  public let mass: Double
  /// Metres per second.
  public private(set) var speed: Double

  /// Drag area of a rider on the hoods, in square metres.
  static let dragArea = 0.32
  static let rollingResistance = 0.004
  /// Air density at sea level, in kilograms per cubic metre.
  static let airDensity = 1.225
  /// The share of the rider's power that reaches the road past the drivetrain.
  static let drivetrainEfficiency = 0.97
  static let gravity = 9.81
  /// Kilograms.
  static let bikeWeight = 9.0
  /// The longest step taken at once, so a late tick still integrates smoothly.
  static let maximumStep: TimeInterval = 0.25

  /// A bike carrying a rider of `riderWeight` kilograms, moving at `speed` metres per second.
  public init(riderWeight: Double, speed: Double = 0) {
    mass = riderWeight + Self.bikeWeight
    self.speed = max(0, speed)
  }

  /// Rides for `duration` seconds at `power` watts up a road of `grade`, a fraction such as
  /// 0.05 for 5%, negative downhill. Returns the metres covered.
  @discardableResult
  public mutating func ride(power: Double, grade: Double, for duration: TimeInterval) -> Double {
    guard duration > 0 else { return 0 }
    let steps = (duration / Self.maximumStep).rounded(.up)
    let step = duration / steps
    var distance = 0.0
    for _ in 0..<Int(steps) {
      let start = speed
      // Resistance only takes energy once the bike moves, so from rest a steep enough descent
      // first gets it rolling.
      if speed == 0 { speed = max(0, -resistance(grade: grade)) / mass * step }
      let work =
        (Self.drivetrainEfficiency * max(0, power) - resistance(grade: grade) * speed) * step
      let energy = max(0, 0.5 * mass * speed * speed + work)
      speed = (2 * energy / mass).squareRoot()
      distance += (start + speed) / 2 * step
    }
    return distance
  }

  /// The force holding the bike back at its current speed, in newtons. The grade is the rise
  /// over the run, so the road's angle is its arctangent: gravity pulls along the road by its
  /// sine, and the tyres press on it by its cosine.
  private func resistance(grade: Double) -> Double {
    let angle = atan(grade)
    let drag = 0.5 * Self.airDensity * Self.dragArea * speed * speed
    let rolling = Self.rollingResistance * mass * Self.gravity * cos(angle)
    let climbing = mass * Self.gravity * sin(angle)
    return drag + rolling + climbing
  }
}
