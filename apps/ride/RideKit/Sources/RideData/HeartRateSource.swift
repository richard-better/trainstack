import Foundation

/// Where a heart rate reading came from. The rider is always told, since a watch on the wrist
/// lags behind a chest strap when gripping the bars.
public enum HeartRateSource: String, CaseIterable, Codable, Sendable {
  case chestStrap, watch, simulated

  public var name: String {
    switch self {
    case .chestStrap: "Chest strap"
    case .watch: "Apple Watch"
    case .simulated: "Simulated"
    }
  }
}

/// Picks one heart rate from every source reporting it: a chest strap over the watch, and
/// either over a simulated one. A source that has gone quiet for `maxAge` no longer counts, so
/// a strap that drops out hands back to the watch.
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

  /// How long a reading stands. Straps send one a second; the watch can take a few seconds.
  public static let maxAge: TimeInterval = 10

  private var latest: [HeartRateSource: Reading] = [:]

  public init() {}

  public mutating func record(_ reading: Reading) {
    latest[reading.source] = reading
  }

  /// The reading to use at `date`, or nil when no source has reported lately.
  public func current(at date: Date) -> Reading? {
    HeartRateSource.allCases.lazy
      .compactMap { latest[$0] }
      .first { date.timeIntervalSince($0.date) <= Self.maxAge }
  }
}
