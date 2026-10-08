import Foundation

/// A reading from the Heart Rate Measurement characteristic (0x2A37).
struct HeartRateMeasurement: Equatable, Sendable {
  var beatsPerMinute: Int
  /// Whether the sensor is touching skin, or nil when it cannot tell.
  var hasContact: Bool?

  init(beatsPerMinute: Int, hasContact: Bool? = nil) {
    self.beatsPerMinute = beatsPerMinute
    self.hasContact = hasContact
  }

  /// Decodes the characteristic's value, or nil when it is too short to hold a heart rate.
  init?(_ data: Data) {
    let bytes = [UInt8](data)
    guard let flags = bytes.first else { return nil }
    if flags & 0x01 == 0 {
      guard bytes.count >= 2 else { return nil }
      beatsPerMinute = Int(bytes[1])
    } else {
      guard bytes.count >= 3 else { return nil }
      beatsPerMinute = Int(bytes[1]) | Int(bytes[2]) << 8
    }
    hasContact = flags & 0x04 == 0 ? nil : flags & 0x02 != 0
  }

  /// The heart rate, unless the sensor says it is not being worn.
  var reading: Int? { hasContact == false || beatsPerMinute == 0 ? nil : beatsPerMinute }

  /// The characteristic's value, in the one-byte form whenever the heart rate fits, with skin
  /// contact reported when known.
  var data: Data {
    var flags: UInt8 = hasContact.map { $0 ? 0b110 : 0b100 } ?? 0
    let bpm = UInt16(clamping: beatsPerMinute)
    guard bpm > UInt8.max else { return Data([flags, UInt8(bpm)]) }
    flags |= 0x01
    return Data([flags, UInt8(bpm & 0xFF), UInt8(bpm >> 8)])
  }
}
