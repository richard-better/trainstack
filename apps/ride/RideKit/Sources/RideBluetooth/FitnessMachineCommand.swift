import Foundation

/// A write to the FTMS Fitness Machine Control Point (0x2AD9).
enum FitnessMachineCommand: Equatable, Sendable {
  case requestControl
  /// Releases control and returns the trainer to its default settings.
  case reset
  case start
  /// Watts.
  case targetPower(Int)
  /// In the trainer's units of 0.1. FTMS 1.0 sends one byte, but a trainer whose range reaches
  /// past it can only take two.
  case targetResistance(Int, wide: Bool)
  /// Percent gradient, on a road with no wind and typical rolling resistance and drag.
  case simulation(grade: Double)

  var opCode: UInt8 {
    switch self {
    case .requestControl: 0x00
    case .reset: 0x01
    case .targetResistance: 0x04
    case .targetPower: 0x05
    case .start: 0x07
    case .simulation: 0x11
    }
  }

  var data: Data {
    var data = Data([opCode])
    switch self {
    case .requestControl, .reset, .start: break
    case .targetPower(let watts): data.append(sint16: watts)
    case .targetResistance(let level, let wide):
      if wide {
        data.append(sint16: level)
      } else {
        data.append(UInt8(level.clamped(to: 0...255)))
      }
    case .simulation(let grade):
      data.append(sint16: 0)  // wind speed
      data.append(sint16: Int((grade * 100).rounded()))
      data.append(40)  // rolling resistance coefficient, 0.004
      data.append(51)  // wind resistance coefficient, 0.51 kg/m
    }
    return data
  }
}

extension Data {
  fileprivate mutating func append(sint16 value: Int) {
    let value = UInt16(bitPattern: Int16(value.clamped(to: Int(Int16.min)...Int(Int16.max))))
    append(contentsOf: [UInt8(value & 0xFF), UInt8(value >> 8)])
  }
}
