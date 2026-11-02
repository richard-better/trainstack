import Foundation

struct FitnessMachineResponse: Equatable, Sendable {
  enum Result: UInt8, Sendable {
    case success = 0x01
    case notSupported = 0x02
    case invalidParameter = 0x03
    case failed = 0x04
    case notPermitted = 0x05
  }

  static let responseCode: UInt8 = 0x80

  let requestOpCode: UInt8
  let result: Result

  init(requestOpCode: UInt8, result: Result) {
    self.requestOpCode = requestOpCode
    self.result = result
  }

  init?(_ data: Data) {
    var reader = BluetoothValueReader(data)
    guard reader.uint8() == Self.responseCode, let requestOpCode = reader.uint8(),
      let code = reader.uint8()
    else { return nil }
    self.requestOpCode = requestOpCode
    result = Result(rawValue: code) ?? .failed
  }
}
