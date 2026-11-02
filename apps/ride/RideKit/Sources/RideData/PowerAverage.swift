import Foundation

public struct PowerAverage: Equatable, Sendable {
  private struct Reading: Equatable, Sendable {
    var power: Int?
    var duration: TimeInterval
  }

  public let span: TimeInterval
  private var readingsOldestFirst: [Reading] = []

  public init(keeping span: TimeInterval = PowerDisplay.longestWindow) {
    self.span = span
  }

  public mutating func record(_ power: Int?, over duration: TimeInterval) {
    readingsOldestFirst.append(Reading(power: power, duration: max(duration, 0)))
    var kept: TimeInterval = 0
    var first = readingsOldestFirst.endIndex
    while first > readingsOldestFirst.startIndex, kept < span {
      first -= 1
      kept += readingsOldestFirst[first].duration
    }
    readingsOldestFirst.removeFirst(first)
  }

  public var latest: Int? { readingsOldestFirst.last?.power }

  public func average(over window: TimeInterval) -> Int? {
    guard window > 0 else { return latest }
    var remaining = window
    var energy: Double = 0
    var covered: TimeInterval = 0
    for reading in readingsOldestFirst.reversed() {
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
