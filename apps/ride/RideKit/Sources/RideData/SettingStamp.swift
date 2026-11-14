import Foundation

public struct SettingStamp: Hashable, Comparable, Codable, Sendable {
  public let milliseconds: Int64

  public init(milliseconds: Int64) {
    self.milliseconds = milliseconds
  }

  public init(_ date: Date) {
    milliseconds = Int64((date.timeIntervalSince1970 * 1000).rounded(.down))
  }

  public static let beforeAnyEdit = SettingStamp(milliseconds: 0)

  public var date: Date { Date(timeIntervalSince1970: Double(milliseconds) / 1000) }

  public var next: SettingStamp { SettingStamp(milliseconds: milliseconds + 1) }

  public var iso8601: String {
    let (seconds, millis) = milliseconds.quotientAndRemainder(dividingBy: 1000)
    let whole = seconds - (millis < 0 ? 1 : 0)
    let fraction = millis < 0 ? millis + 1000 : millis
    let text = Date(timeIntervalSince1970: Double(whole)).formatted(.iso8601)
    return text.dropLast() + String(format: ".%03dZ", fraction)
  }

  public init?(iso8601 text: String) {
    guard text.hasSuffix("Z") else { return nil }
    let body = text.dropLast()
    let parts = body.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
    guard let whole = try? Date(String(parts[0]) + "Z", strategy: .iso8601) else { return nil }
    var millis: Int64 = 0
    if parts.count == 2 {
      let digits = parts[1]
      guard !digits.isEmpty, digits.allSatisfy(\.isASCII), digits.allSatisfy(\.isNumber),
        let value = Int64(
          String(digits.prefix(3)).padding(toLength: 3, withPad: "0", startingAt: 0))
      else { return nil }
      millis = value
    }
    milliseconds = Int64(whole.timeIntervalSince1970.rounded()) * 1000 + millis
  }

  public static func < (lhs: SettingStamp, rhs: SettingStamp) -> Bool {
    lhs.milliseconds < rhs.milliseconds
  }
}
