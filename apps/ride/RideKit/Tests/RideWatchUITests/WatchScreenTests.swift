import Foundation
import RideLink
import Testing

@testable import RideWatchUI

struct WatchScreenTests {
  private let start = Date(timeIntervalSinceReferenceDate: 0)

  private func glance(remaining: Double, isPaused: Bool = false) -> RideGlance {
    RideGlance(
      workoutName: "Threshold 3×10",
      interval: .init(index: 1, zone: .threshold, remaining: remaining, duration: 600),
      isPaused: isPaused)
  }

  private func screen(
    startedOnPhone: Bool = true, glance: RideGlance? = nil, received: TimeInterval = 4,
    at seconds: TimeInterval
  ) -> WatchScreen {
    WatchScreen(
      workout: WatchWorkout(startDate: start, startedOnPhone: startedOnPhone),
      glance: glance.map { ReceivedGlance(glance: $0, date: start + received) },
      at: start + seconds)
  }

  @Test func isIdleWithoutAWorkout() {
    #expect(WatchScreen(workout: nil, glance: nil, at: start) == .idle)
  }

  @Test func countsIntoARideStartedOnThePhone() {
    #expect(screen(at: 0) == .starting(count: 3))
    #expect(screen(at: 1.5) == .starting(count: 2))
    #expect(screen(at: 2.9) == .starting(count: 1))
    #expect(screen(at: 3) == .relaying)
  }

  @Test func goesStraightToHeartRateWhenStartedOnTheWatch() {
    #expect(screen(startedOnPhone: false, at: 0) == .relaying)
  }

  @Test func showsTheRideWhileThePhoneKeepsSending() {
    let ride = glance(remaining: 300)
    #expect(screen(glance: ride, at: 5) == .glance(ride))
    #expect(screen(glance: ride, at: 9) == .glance(ride))
    #expect(screen(glance: ride, at: 9.5) == .relaying)
  }

  @Test func countsDownTheEndOfAnInterval() {
    #expect(
      screen(glance: glance(remaining: 3), at: 5)
        == .intervalEnding(glance(remaining: 3), seconds: 3))
    #expect(
      screen(glance: glance(remaining: 0.4), at: 5)
        == .intervalEnding(glance(remaining: 0.4), seconds: 1))
    #expect(screen(glance: glance(remaining: 4), at: 5) == .glance(glance(remaining: 4)))
  }

  @Test func doesNotCountDownWhilePaused() {
    let paused = glance(remaining: 2, isPaused: true)
    #expect(screen(glance: paused, at: 5) == .glance(paused))
  }
}
