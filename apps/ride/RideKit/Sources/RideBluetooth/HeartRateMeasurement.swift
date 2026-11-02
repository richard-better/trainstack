import Foundation

struct HeartRateMeasurement: Equatable, Sendable {
  private struct Flags: OptionSet {
    let rawValue: UInt8

    static let sixteenBitValue = Flags(rawValue: 1 << 0)
    static let contactDetected = Flags(rawValue: 1 << 1)
    static let contactSupported = Flags(rawValue: 1 << 2)
  }

  var beatsPerMinute: Int
  var hasContact: Bool?

  init(beatsPerMinute: Int, hasContact: Bool? = nil) {
    self.beatsPerMinute = beatsPerMinute
    self.hasContact = hasContact
  }

  init?(_ data: Data) {
    var reader = BluetoothValueReader(data)
    guard let rawFlags = reader.uint8() else { return nil }
    let flags = Flags(rawValue: rawFlags)
    if flags.contains(.sixteenBitValue) {
      guard let value = reader.uint16() else { return nil }
      beatsPerMinute = Int(value)
    } else {
      guard let value = reader.uint8() else { return nil }
      beatsPerMinute = Int(value)
    }
    hasContact = flags.contains(.contactSupported) ? flags.contains(.contactDetected) : nil
  }

  var reading: Int? { hasContact == false || beatsPerMinute == 0 ? nil : beatsPerMinute }

  var data: Data {
    var flags: Flags = []
    if let hasContact {
      flags.insert(.contactSupported)
      if hasContact { flags.insert(.contactDetected) }
    }
    let bpm = UInt16(clamping: beatsPerMinute)
    guard bpm > UInt8.max else { return Data([flags.rawValue, UInt8(bpm)]) }
    flags.insert(.sixteenBitValue)
    return Data([flags.rawValue, UInt8(bpm & 0xFF), UInt8(bpm >> 8)])
  }
}
