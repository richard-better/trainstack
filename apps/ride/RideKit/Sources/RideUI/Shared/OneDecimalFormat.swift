import Foundation

extension FormatStyle where Self == FloatingPointFormatStyle<Double> {
  static var oneDecimal: Self { .number.precision(.fractionLength(1)) }
}
