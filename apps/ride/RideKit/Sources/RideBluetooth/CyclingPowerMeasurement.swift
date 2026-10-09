import Foundation

/// Cycling Power Measurement (0x2A63), including the optional crank data for cadence.
struct CyclingPowerMeasurement: Equatable, Sendable {
  let watts: Int
  let crank: CrankRevolution?

  init?(_ data: Data) {
    var reader = BluetoothValueReader(data)
    guard let flags = reader.uint16(), let power = reader.uint16() else { return nil }
    watts = Int(Int16(bitPattern: power))
    for (bit, size) in [(0, 1), (2, 2), (4, 6)] where flags & (1 << bit) != 0 {
      guard reader.skip(size) else { return nil }
    }
    if flags & (1 << 5) != 0 {
      guard let count = reader.uint16(), let time = reader.uint16() else { return nil }
      crank = CrankRevolution(count: count, eventTime: time)
    } else {
      crank = nil
    }
    for (bit, size) in [(6, 4), (7, 4), (8, 3), (9, 2), (10, 2), (11, 2)]
    where flags & (1 << bit) != 0 {
      guard reader.skip(size) else { return nil }
    }
  }
}
