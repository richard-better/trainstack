import Foundation

/// CSC Measurement (0x2A5B). Wheel-only packets are valid but contain no cadence.
struct CyclingSpeedCadenceMeasurement: Equatable, Sendable {
  let crank: CrankRevolution?

  init?(_ data: Data) {
    var reader = BluetoothValueReader(data)
    guard let flags = reader.uint8() else { return nil }
    if flags & 1 != 0 {
      guard reader.skip(6) else { return nil }
    }
    if flags & 2 != 0 {
      guard let count = reader.uint16(), let time = reader.uint16() else { return nil }
      crank = CrankRevolution(count: count, eventTime: time)
    } else {
      crank = nil
    }
  }
}
