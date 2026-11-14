import Foundation

public struct SettingDay: Hashable, Comparable, Codable, Sendable {
  public let year: Int
  public let month: Int
  public let day: Int

  public init?(_ text: String) {
    let parts = text.split(separator: "-", omittingEmptySubsequences: false)
    guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
      let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
      (1...12).contains(month), (1...31).contains(day)
    else { return nil }
    self.year = year
    self.month = month
    self.day = day
  }

  public init(_ date: Date, calendar: Calendar = .current) {
    let components = Self.gregorian(in: calendar).dateComponents(
      [.year, .month, .day], from: date)
    year = components.year ?? 1970
    month = components.month ?? 1
    day = components.day ?? 1
  }

  public func date(in calendar: Calendar = .current) -> Date {
    let gregorian = Self.gregorian(in: calendar)
    return gregorian.date(from: DateComponents(year: year, month: month, day: day))
      .map(gregorian.startOfDay(for:)) ?? .distantPast
  }

  private static func gregorian(in calendar: Calendar) -> Calendar {
    var gregorian = Calendar(identifier: .gregorian)
    gregorian.timeZone = calendar.timeZone
    return gregorian
  }

  public var text: String {
    String(format: "%04d-%02d-%02d", year, month, day)
  }

  public static func < (lhs: SettingDay, rhs: SettingDay) -> Bool {
    (lhs.year, lhs.month, lhs.day) < (rhs.year, rhs.month, rhs.day)
  }

  public init(from decoder: any Decoder) throws {
    let text = try decoder.singleValueContainer().decode(String.self)
    guard let day = SettingDay(text) else {
      throw DecodingError.dataCorrupted(
        .init(codingPath: decoder.codingPath, debugDescription: "\(text) is not a YYYY-MM-DD day"))
    }
    self = day
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(text)
  }
}
