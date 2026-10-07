import Foundation

extension FormatStyle where Self == FloatingPointFormatStyle<Double> {
  /// A number with one decimal place, such as `24.5`.
  static var oneDecimal: Self { .number.precision(.fractionLength(1)) }
}
