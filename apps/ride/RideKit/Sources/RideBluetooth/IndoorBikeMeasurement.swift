import Foundation

struct IndoorBikeMeasurement: Equatable, Sendable {
  private struct Flags: OptionSet {
    let rawValue: UInt16

    static let moreDataOmitsInstantaneousSpeed = Flags(rawValue: 1 << 0)
    static let averageSpeed = Flags(rawValue: 1 << 1)
    static let instantaneousCadence = Flags(rawValue: 1 << 2)
    static let averageCadence = Flags(rawValue: 1 << 3)
    static let totalDistance = Flags(rawValue: 1 << 4)
    static let resistanceLevel = Flags(rawValue: 1 << 5)
    static let instantaneousPower = Flags(rawValue: 1 << 6)
    static let averagePower = Flags(rawValue: 1 << 7)
    static let expendedEnergy = Flags(rawValue: 1 << 8)
    static let heartRate = Flags(rawValue: 1 << 9)
    static let metabolicEquivalent = Flags(rawValue: 1 << 10)
    static let elapsedTime = Flags(rawValue: 1 << 11)
    static let remainingTime = Flags(rawValue: 1 << 12)

    static let sizesBetweenCadenceAndPower: [(Flags, Int)] = [
      (.averageCadence, 2), (.totalDistance, 3), (.resistanceLevel, 2),
    ]
    static let sizesAfterPower: [(Flags, Int)] = [
      (.averagePower, 2), (.expendedEnergy, 5), (.heartRate, 1), (.metabolicEquivalent, 1),
      (.elapsedTime, 2), (.remainingTime, 2),
    ]
  }

  static let cadenceUnitsPerRPM = 2.0

  let watts: Int?
  let cadence: Int?

  init?(_ data: Data) {
    var reader = BluetoothValueReader(data)
    guard let rawFlags = reader.uint16() else { return nil }
    let flags = Flags(rawValue: rawFlags)
    if !flags.contains(.moreDataOmitsInstantaneousSpeed) {
      guard reader.skip(2) else { return nil }
    }
    if flags.contains(.averageSpeed) {
      guard reader.skip(2) else { return nil }
    }
    if flags.contains(.instantaneousCadence) {
      guard let value = reader.uint16() else { return nil }
      cadence = Int((Double(value) / Self.cadenceUnitsPerRPM).rounded())
    } else {
      cadence = nil
    }
    for (field, size) in Flags.sizesBetweenCadenceAndPower where flags.contains(field) {
      guard reader.skip(size) else { return nil }
    }
    if flags.contains(.instantaneousPower) {
      guard let value = reader.uint16() else { return nil }
      watts = Int(Int16(bitPattern: value))
    } else {
      watts = nil
    }
    for (field, size) in Flags.sizesAfterPower where flags.contains(field) {
      guard reader.skip(size) else { return nil }
    }
  }
}
