import Foundation

/// The trainer's indication on the Fitness Machine Control Point once it has carried out, or
/// refused, a command.
struct FitnessMachineResponse: Equatable, Sendable {
  enum Result: UInt8, Sendable {
    case success = 0x01
    case notSupported = 0x02
    case invalidParameter = 0x03
    case failed = 0x04
    case notPermitted = 0x05
  }

  /// The op code of the command answered.
  let opCode: UInt8
  let result: Result

  init(opCode: UInt8, result: Result) {
    self.opCode = opCode
    self.result = result
  }

  init?(_ data: Data) {
    var reader = BluetoothValueReader(data)
    guard reader.uint8() == 0x80, let opCode = reader.uint8(), let code = reader.uint8() else {
      return nil
    }
    self.opCode = opCode
    // Codes reserved for future use are failures as far as Ride can tell.
    result = Result(rawValue: code) ?? .failed
  }
}
