import Foundation

struct CyclingPowerMeasurement: Equatable, Sendable {
  private struct Flags: OptionSet {
    let rawValue: UInt16

    static let pedalPowerBalance = Flags(rawValue: 1 << 0)
    static let accumulatedTorque = Flags(rawValue: 1 << 2)
    static let wheelRevolutions = Flags(rawValue: 1 << 4)
    static let crankRevolutions = Flags(rawValue: 1 << 5)
    static let extremeForceMagnitudes = Flags(rawValue: 1 << 6)
    static let extremeTorqueMagnitudes = Flags(rawValue: 1 << 7)
    static let extremeAngles = Flags(rawValue: 1 << 8)
    static let topDeadSpotAngle = Flags(rawValue: 1 << 9)
    static let bottomDeadSpotAngle = Flags(rawValue: 1 << 10)
    static let accumulatedEnergy = Flags(rawValue: 1 << 11)

    static let sizesBeforeCrank: [(Flags, Int)] = [
      (.pedalPowerBalance, 1), (.accumulatedTorque, 2), (.wheelRevolutions, 6),
    ]
    static let sizesAfterCrank: [(Flags, Int)] = [
      (.extremeForceMagnitudes, 4), (.extremeTorqueMagnitudes, 4), (.extremeAngles, 3),
      (.topDeadSpotAngle, 2), (.bottomDeadSpotAngle, 2), (.accumulatedEnergy, 2),
    ]
  }

  let watts: Int
  let crank: CrankRevolution?

  init?(_ data: Data) {
    var reader = BluetoothValueReader(data)
    guard let rawFlags = reader.uint16(), let power = reader.uint16() else { return nil }
    let flags = Flags(rawValue: rawFlags)
    watts = Int(Int16(bitPattern: power))
    for (field, size) in Flags.sizesBeforeCrank where flags.contains(field) {
      guard reader.skip(size) else { return nil }
    }
    if flags.contains(.crankRevolutions) {
      guard let count = reader.uint16(), let time = reader.uint16() else { return nil }
      crank = CrankRevolution(count: count, eventTime: time)
    } else {
      crank = nil
    }
    for (field, size) in Flags.sizesAfterCrank where flags.contains(field) {
      guard reader.skip(size) else { return nil }
    }
  }
}
