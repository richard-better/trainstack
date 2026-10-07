import Foundation
import RideLink
import Testing

@testable import RideWatch

struct WorkoutRelayTests {
  private func glance(remaining: Double) -> RideGlance {
    RideGlance(
      workoutName: "Threshold 3×10",
      interval: .init(index: 1, zone: .threshold, remaining: remaining, duration: 600))
  }

  @Test func tapsTheWristAsGlancesCountDownAnInterval() {
    let relay = WorkoutRelay()
    var cues: [IntervalCue] = []
    relay.onCue = { cues.append($0) }
    relay.start(fromPhone: true)
    for remaining in stride(from: 12.0, through: 0, by: -1) {
      relay.receive(.glance(glance(remaining: remaining)))
    }
    #expect(cues == [.warning, .count(3), .count(2), .count(1)])
    #expect(relay.glance?.glance == glance(remaining: 0))
  }

  @Test func endsTheWorkoutWhenTheRideEnds() {
    let relay = WorkoutRelay()
    relay.onCue = { _ in }
    relay.start(fromPhone: true)
    relay.receive(.glance(glance(remaining: 300)))
    relay.receive(.rideEnded)
    #expect(relay.workout == nil)
    #expect(relay.glance == nil)
  }
}
