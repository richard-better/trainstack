import Foundation
import RideLink

/// What the watch shows, which follows from the workout and what the phone last sent.
enum WatchScreen: Equatable {
  /// No workout: a button to start relaying heart rate.
  case idle
  /// The first seconds after the phone opened the app, counting into the ride.
  case starting(count: Int)
  /// The ride as the phone last sent it.
  case glance(RideGlance)
  /// The last seconds of an interval, counting into the next.
  case intervalEnding(RideGlance, seconds: Int)
  /// Heart rate alone, when no ride is coming from the phone, such as a ride on a Mac.
  case relaying

  /// How long the opening count lasts.
  static let startingCount = 3
  /// How long a glance stands without another. The phone sends one a second.
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
    guard let glance, date.timeIntervalSince(glance.date) <= Self.glanceLifetime else {
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

/// A workout the watch is recording.
struct WatchWorkout: Equatable {
  var startDate: Date
  /// Whether starting a ride on the phone opened the app, rather than the rider on the watch.
  var startedOnPhone: Bool
}

/// A glance and when it arrived.
struct ReceivedGlance: Equatable {
  var glance: RideGlance
  var date: Date
}
