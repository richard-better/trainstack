import Foundation

struct FitnessMachineFeatures: Equatable, Sendable {
  static let spinDownControlBit: UInt32 = 1 << 15

  let machine: UInt32
  let targetSettings: UInt32

  init?(_ data: Data) {
    guard data.count >= 8 else { return nil }
    let bytes = Array(data)
    func uint32(at offset: Int) -> UInt32 {
      (0..<4).reduce(0) { $0 | UInt32(bytes[offset + $1]) << (8 * $1) }
    }
    machine = uint32(at: 0)
    targetSettings = uint32(at: 4)
  }

  var supportsSpinDown: Bool { targetSettings & Self.spinDownControlBit != 0 }
}
