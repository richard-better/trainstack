import Foundation
import RideLink

enum WatchScreen: Equatable {
  case idle
  case starting(count: Int)
  case glance(RideGlance)
  case intervalEnding(RideGlance, seconds: Int)
  case relaying

  static let startingCount = 3
  static let glanceLifetime: TimeInterval = 5

  init(workout: WatchWorkout?, glance: ReceivedGlance?, at date: Date) {
    guard let workout else {
      self = .idle
      return
    }
    let elapsed = date.timeIntervalSince(workout.startDate)
    if workout.startedOnPhone, elapsed >= 0, elapsed < Double(Self.startingCount) {
      self = .starting(count: Self.startingCount - Int(elapsed))
      return
    }
    guard let glance, date.timeIntervalSince(glance.receivedAt) <= Self.glanceLifetime else {
      self = .relaying
      return
    }
    if let interval = glance.glance.interval, !glance.glance.isPaused, interval.remaining > 0,
      interval.remaining <= Double(IntervalCountdown.countFrom)
    {
      self = .intervalEnding(glance.glance, seconds: Int(interval.remaining.rounded(.up)))
    } else {
      self = .glance(glance.glance)
    }
  }
}
