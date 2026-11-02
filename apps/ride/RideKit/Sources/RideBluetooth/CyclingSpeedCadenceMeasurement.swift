import Foundation

struct CyclingSpeedCadenceMeasurement: Equatable, Sendable {
  private struct Flags: OptionSet {
    let rawValue: UInt8

    static let wheelRevolutions = Flags(rawValue: 1 << 0)
    static let crankRevolutions = Flags(rawValue: 1 << 1)
  }

  private static let wheelRevolutionsSize = 6

  let crank: CrankRevolution?

  init?(_ data: Data) {
    var reader = BluetoothValueReader(data)
    guard let rawFlags = reader.uint8() else { return nil }
    let flags = Flags(rawValue: rawFlags)
    if flags.contains(.wheelRevolutions) {
      guard reader.skip(Self.wheelRevolutionsSize) else { return nil }
    }
    if flags.contains(.crankRevolutions) {
      guard let count = reader.uint16(), let time = reader.uint16() else { return nil }
      crank = CrankRevolution(count: count, eventTime: time)
    } else {
      crank = nil
    }
  }
}
