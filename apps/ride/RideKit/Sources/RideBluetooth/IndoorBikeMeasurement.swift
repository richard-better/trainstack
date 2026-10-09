import Foundation

/// FTMS Indoor Bike Data (0x2AD2). Fields may arrive in separate notifications.
struct IndoorBikeMeasurement: Equatable, Sendable {
  let watts: Int?
  let cadence: Int?

  init?(_ data: Data) {
    var reader = BluetoothValueReader(data)
    guard let flags = reader.uint16() else { return nil }
    // More Data is inverted: speed is present when bit 0 is clear.
    if flags & 1 == 0 {
      guard reader.skip(2) else { return nil }
    }
    if flags & (1 << 1) != 0 {
      guard reader.skip(2) else { return nil }
    }
    if flags & (1 << 2) != 0 {
      guard let value = reader.uint16() else { return nil }
      cadence = Int((Double(value) / 2).rounded())
    } else {
      cadence = nil
    }
    for (bit, size) in [(3, 2), (4, 3), (5, 2)] where flags & (1 << bit) != 0 {
      guard reader.skip(size) else { return nil }
    }
    if flags & (1 << 6) != 0 {
      guard let value = reader.uint16() else { return nil }
      watts = Int(Int16(bitPattern: value))
    } else {
      watts = nil
    }
    for (bit, size) in [(7, 2), (8, 5), (9, 1), (10, 1), (11, 2), (12, 2)]
    where flags & (1 << bit) != 0 {
      guard reader.skip(size) else { return nil }
    }
  }
}
