import Foundation

/// The last few seconds of power, to show it averaged rather than jumping from one reading to
/// the next. Each reading stands for the time since the one before, so the average is over time
/// however often readings come. A rider who stops pedalling reads zero, which counts; a missing
/// reading counts for nothing either way.
public struct PowerAverage: Equatable, Sendable {
  private struct Reading: Equatable, Sendable {
    var power: Int?
    var duration: TimeInterval
  }

  /// How many seconds of readings are kept, the longest window there is an average over.
  public let span: TimeInterval
  /// Oldest first.
  private var readings: [Reading] = []

  public init(keeping span: TimeInterval = PowerDisplay.longestWindow) {
    self.span = span
  }

  /// Adds a reading that covers the last `duration` seconds, and forgets those older than `span`.
  public mutating func record(_ power: Int?, over duration: TimeInterval) {
    readings.append(Reading(power: power, duration: max(duration, 0)))
    var kept: TimeInterval = 0
    var first = readings.endIndex
    while first > readings.startIndex, kept < span {
      first -= 1
      kept += readings[first].duration
    }
    readings.removeFirst(first)
  }

  /// The latest reading's power.
  public var latest: Int? { readings.last?.power }

  /// Average power over the last `window` seconds, or the latest reading without a window. Nil
  /// when nothing in the window had power.
  public func average(over window: TimeInterval) -> Int? {
    guard window > 0 else { return latest }
    var remaining = window
    var energy: Double = 0
    var covered: TimeInterval = 0
    for reading in readings.reversed() {
      guard remaining > 0 else { break }
      let share = min(reading.duration, remaining)
      remaining -= share
      if let power = reading.power {
        energy += Double(power) * share
        covered += share
      }
    }
    return covered > 0 ? Int((energy / covered).rounded()) : nil
  }
}
