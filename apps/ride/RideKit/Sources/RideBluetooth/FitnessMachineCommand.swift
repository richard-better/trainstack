import Foundation

enum FitnessMachineCommand: Equatable, Sendable {
  case requestControl
  case reset
  case start
  case targetPower(watts: Int)
  case targetResistance(level: Int, wide: Bool)
  case simulation(gradePercent: Double)

  static let stillAirMetresPerSecond = 0.0
  static let typicalRollingResistanceCoefficient = 0.004
  static let typicalWindResistanceKilogramsPerMetre = 0.51

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
    case .simulation(let gradePercent):
      data.append(sint16: Self.stillAirMetresPerSecond, resolution: 0.001)
      data.append(sint16: gradePercent, resolution: 0.01)
      data.append(uint8: Self.typicalRollingResistanceCoefficient, resolution: 0.0001)
      data.append(uint8: Self.typicalWindResistanceKilogramsPerMetre, resolution: 0.01)
    }
    return data
  }
}

extension Data {
  fileprivate mutating func append(sint16 value: Int) {
    let value = UInt16(bitPattern: Int16(value.clamped(to: Int(Int16.min)...Int(Int16.max))))
    append(contentsOf: [UInt8(value & 0xFF), UInt8(value >> 8)])
  }

  fileprivate mutating func append(sint16 value: Double, resolution: Double) {
    append(sint16: Int((value / resolution).rounded()))
  }

  fileprivate mutating func append(uint8 value: Double, resolution: Double) {
    append(UInt8(Int((value / resolution).rounded()).clamped(to: 0...255)))
  }
}
