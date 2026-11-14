public enum SpinDown: Equatable, Sendable {
  case starting
  case speedUp(targetKilometresPerHour: ClosedRange<Double>?)
  case stopPedalling
  case succeeded
  case failed
  case unsupported

  static let statusOpCode: UInt8 = 0x14
  static let requested: UInt8 = 0x01
  static let success: UInt8 = 0x02
  static let error: UInt8 = 0x03
  static let stopPedallingStatus: UInt8 = 0x04
  static let kilometresPerHourPerUnit = 0.01

  public var isUnderway: Bool {
    switch self {
    case .starting, .speedUp, .stopPedalling: true
    case .succeeded, .failed, .unsupported: false
    }
  }
}
