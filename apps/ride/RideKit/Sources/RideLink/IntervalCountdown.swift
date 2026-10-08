import Foundation

/// A tap on the wrist as an interval ends, so the rider need not watch the screen.
public enum IntervalCue: Equatable, Sendable {
  /// Ten seconds to go.
  case warning
  /// One of the last three seconds, counting down.
  case count(Int)
}

/// Turns the interval's time left, as each glance brings it, into cues: one ten seconds before
/// the change, then one a second for the last three. Skipping to another interval or pausing
/// sets nothing off.
public struct IntervalCountdown: Sendable {
  public static let warning: TimeInterval = 10
  public static let countFrom = 3

  private var last: (index: Int, remaining: TimeInterval)?

  public init() {}

  /// The cue due now, if any, as the ride reaches `interval`.
  public mutating func update(_ interval: RideGlance.Interval?, isPaused: Bool) -> IntervalCue? {
    defer { last = interval.map { ($0.index, $0.remaining) } }
    guard let interval, !isPaused, let last, last.index == interval.index else { return nil }
    let crossed = { (mark: TimeInterval) in last.remaining > mark && interval.remaining <= mark }
    // A late glance can skip a second; only the latest count is worth a tap.
    if let count = (1...Self.countFrom).first(where: { crossed(TimeInterval($0)) }) {
      return .count(count)
    }
    return crossed(Self.warning) ? .warning : nil
  }
}
