import Foundation

/// Reads little-endian GATT fields without assuming alignment or a complete packet.
struct BluetoothValueReader {
  private let bytes: [UInt8]
  private var offset = 0

  init(_ data: Data) { bytes = Array(data) }

  mutating func uint8() -> UInt8? {
    guard offset < bytes.count else { return nil }
    defer { offset += 1 }
    return bytes[offset]
  }

  mutating func uint16() -> UInt16? {
    guard let low = uint8(), let high = uint8() else { return nil }
    return UInt16(low) | UInt16(high) << 8
  }

  mutating func skip(_ count: Int) -> Bool {
    guard offset + count <= bytes.count else { return false }
    offset += count
    return true
  }
}
