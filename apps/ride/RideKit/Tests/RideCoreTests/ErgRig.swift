import Foundation

struct ErgRig {
  struct Second: Equatable {
    var trainer: Int
    var meter: Int
    var hub: Double
  }

  static let stepsPerSecond = 10
  static let deadTimeSeconds = 1.0
  static let naturalFrequency = 1.2
  static let damping = 0.6
  static let freeRideWatts = 150.0
  static let coastingTimeConstant = 1.0
  static let trainerNoiseWatts = 3.0
  static let meterNoiseWatts = 4.0

  let meterFactor: Double
  private var hub = 0.0
  private var velocity = 0.0
  private var delayedCommands: [Double]
  private var lastHub = 0.0
  private var random: UInt64

  init(meterFactor: Double, seed: UInt64 = 7) {
    self.meterFactor = meterFactor
    random = seed
    delayedCommands = Array(
      repeating: 0, count: Int(Self.deadTimeSeconds * Double(Self.stepsPerSecond)))
  }

  mutating func second(commanded: Int?, pedalling: Bool) -> Second {
    let dt = 1 / Double(Self.stepsPerSecond)
    let meterSeesHub = lastHub
    for _ in 0..<Self.stepsPerSecond {
      delayedCommands.append(Double(commanded ?? Int(Self.freeRideWatts)))
      let goal = delayedCommands.removeFirst()
      if pedalling {
        let acceleration =
          Self.naturalFrequency * Self.naturalFrequency * (goal - hub)
          - 2 * Self.damping * Self.naturalFrequency * velocity
        velocity += acceleration * dt
        hub += velocity * dt
      } else {
        velocity = 0
        hub -= hub * dt / Self.coastingTimeConstant
      }
      hub = max(0, hub)
    }
    lastHub = hub
    let trainer = hub + noise(Self.trainerNoiseWatts)
    let meter = meterSeesHub * meterFactor + noise(Self.meterNoiseWatts)
    return Second(
      trainer: max(0, Int(trainer.rounded())), meter: max(0, Int(meter.rounded())), hub: hub)
  }

  private mutating func noise(_ amplitude: Double) -> Double {
    random = random &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
    return (Double(random >> 11) / Double(1 << 53) - 0.5) * 2 * amplitude
  }
}
