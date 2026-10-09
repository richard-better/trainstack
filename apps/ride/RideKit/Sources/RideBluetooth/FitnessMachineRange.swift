import Foundation

/// Supported Resistance Level Range (0x2AD6) or Supported Power Range (0x2AD8): the lowest and
/// highest target a trainer takes and its smallest step, in the characteristic's units.
struct FitnessMachineRange: Equatable, Sendable {
  let minimum: Int
  let maximum: Int
  let increment: Int

  init(minimum: Int, maximum: Int, increment: Int) {
    self.minimum = minimum
    self.maximum = maximum
    self.increment = increment
  }

  init?(_ data: Data) {
    var reader = BluetoothValueReader(data)
    guard let minimum = reader.uint16(), let maximum = reader.uint16(),
      let increment = reader.uint16(), Int16(bitPattern: minimum) <= Int16(bitPattern: maximum)
    else { return nil }
    self.minimum = Int(Int16(bitPattern: minimum))
    self.maximum = Int(Int16(bitPattern: maximum))
    self.increment = Int(increment)
  }

  /// The nearest target to `value` the trainer takes.
  func nearest(_ value: Double) -> Int {
    let step = Double(max(increment, 1))
    let steps = ((value - Double(minimum)) / step).rounded()
    return (minimum + Int(steps * step)).clamped(to: minimum...maximum)
  }
}
