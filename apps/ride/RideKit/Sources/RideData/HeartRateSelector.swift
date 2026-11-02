import Foundation

public struct HeartRateSelector: Sendable {
  public struct Reading: Equatable, Sendable {
    public var bpm: Int
    public var source: HeartRateSource
    public var date: Date

    public init(bpm: Int, source: HeartRateSource, date: Date) {
      self.bpm = bpm
      self.source = source
      self.date = date
    }
  }

  public static let maxAge: TimeInterval = 10

  private var latest: [HeartRateSource: Reading] = [:]

  public init() {}

  public mutating func record(_ reading: Reading) {
    latest[reading.source] = reading
  }

  public func latest(from source: HeartRateSource) -> Reading? {
    latest[source]
  }

  public func current(at date: Date) -> Reading? {
    HeartRateSource.allCases.lazy
      .compactMap { latest[$0] }
      .first { date.timeIntervalSince($0.date) <= Self.maxAge }
  }
}
