import Foundation

/// Converts successive crank events to rpm, handling both 16-bit counters rolling over.
struct CrankCadence: Sendable {
  private var previous: CrankRevolution?
  private var receivedAt: Date?
  private var movedAt: Date?
  private var rpm: Int?
  private static let stopDelay: TimeInterval = 3

  mutating func update(_ crank: CrankRevolution, at date: Date) -> Int? {
    defer {
      previous = crank
      receivedAt = date
    }
    guard let previous, let receivedAt, date.timeIntervalSince(receivedAt) <= 10 else {
      movedAt = date
      rpm = nil
      return nil
    }
    let revolutions = crank.count &- previous.count
    let ticks = crank.eventTime &- previous.eventTime
    if revolutions == 0 {
      if let movedAt, date.timeIntervalSince(movedAt) >= Self.stopDelay { rpm = 0 }
      return rpm
    }
    movedAt = date
    guard ticks > 0 else {
      rpm = nil
      return nil
    }
    let cadence = Double(revolutions) * 60 * 1024 / Double(ticks)
    // A counter reset can look like thousands of turns; start again from this event.
    rpm = cadence <= 300 ? Int(cadence.rounded()) : nil
    return rpm
  }
}
