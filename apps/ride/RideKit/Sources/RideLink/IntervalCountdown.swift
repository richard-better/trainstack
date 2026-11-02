import Foundation

public struct IntervalCountdown: Sendable {
  public static let warning: TimeInterval = 10
  public static let countFrom = 3

  private var last: (index: Int, remaining: TimeInterval)?

  public init() {}

  public mutating func update(_ interval: RideGlance.Interval?, isPaused: Bool) -> IntervalCue? {
    defer { last = interval.map { ($0.index, $0.remaining) } }
    guard let interval, !isPaused, let last, last.index == interval.index else { return nil }
    let crossed = { (mark: TimeInterval) in last.remaining > mark && interval.remaining <= mark }
    if let latestSecond = (1...Self.countFrom).first(where: { crossed(TimeInterval($0)) }) {
      return .secondsLeft(latestSecond)
    }
    return crossed(Self.warning) ? .warning : nil
  }
}
