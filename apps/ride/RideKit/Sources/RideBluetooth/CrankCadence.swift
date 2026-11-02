import Foundation

struct CrankCadence: Sendable {
  static let stoppedAfter: TimeInterval = 3
  static let staleAfter: TimeInterval = 10
  static let highestPlausibleRPM = 300.0

  private var previous: CrankRevolution?
  private var receivedAt: Date?
  private var movedAt: Date?
  private var rpm: Int?

  mutating func update(_ crank: CrankRevolution, at date: Date) -> Int? {
    defer {
      previous = crank
      receivedAt = date
    }
    guard let previous, let receivedAt, date.timeIntervalSince(receivedAt) <= Self.staleAfter
    else {
      movedAt = date
      rpm = nil
      return nil
    }
    let revolutions = crank.count &- previous.count
    let ticks = crank.eventTime &- previous.eventTime
    if revolutions == 0 {
      if let movedAt, date.timeIntervalSince(movedAt) >= Self.stoppedAfter { rpm = 0 }
      return rpm
    }
    movedAt = date
    guard ticks > 0 else {
      rpm = nil
      return nil
    }
    let cadence =
      Double(revolutions) * 60 * CrankRevolution.eventTimeTicksPerSecond / Double(ticks)
    rpm = cadence <= Self.highestPlausibleRPM ? Int(cadence.rounded()) : nil
    return rpm
  }
}
