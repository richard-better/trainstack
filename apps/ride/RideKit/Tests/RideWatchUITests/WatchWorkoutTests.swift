import Foundation
import RideLink
import Testing

@testable import RideWatchUI

struct WatchWorkoutTests {
  private let start = Date(timeIntervalSince1970: 1_800_000_000)

  @Test func neverSavesAWorkoutThePhoneStartedSinceThePhoneSavesItsRide() {
    var workout = WatchWorkout(startDate: start, startedOnPhone: true)
    #expect(!workout.savesToHealthItself)
    workout.isRecordedElsewhere = true
    #expect(!workout.savesToHealthItself)
  }

  @Test func savesAWorkoutStartedOnTheWatchUnlessTheRideIsRecordedElsewhere() {
    var workout = WatchWorkout(startDate: start, startedOnPhone: false)
    #expect(workout.savesToHealthItself)
    workout.isRecordedElsewhere = true
    #expect(!workout.savesToHealthItself)
  }

  @Test func givesUpOnAPhoneThatHasBeenQuietForFiveMinutes() {
    var workout = WatchWorkout(startDate: start, startedOnPhone: true)
    let limit = WatchWorkout.phoneSilenceLimit
    #expect(!workout.hasLostThePhone(at: start.addingTimeInterval(limit - 1)))
    #expect(workout.hasLostThePhone(at: start.addingTimeInterval(limit)))
    workout.lastHeardFromPhone = start.addingTimeInterval(limit)
    #expect(!workout.hasLostThePhone(at: start.addingTimeInterval(limit + 60)))
  }

  @Test func neverGivesUpOnAWorkoutTheRiderStartedOnTheWatch() {
    let workout = WatchWorkout(startDate: start, startedOnPhone: false)
    #expect(!workout.hasLostThePhone(at: start.addingTimeInterval(24 * 3600)))
  }

  @Test func eachGlanceCountsAsHearingFromThePhone() {
    let relay = WorkoutRelay()
    relay.playCue = { _ in }
    relay.start(fromPhone: true)
    let later = Date.now.addingTimeInterval(120)
    relay.receive(
      .glance(
        RideGlance(
          workoutName: "Threshold 3×10",
          interval: .init(index: 1, zone: .threshold, remaining: 300, duration: 600))),
      at: later)
    #expect(relay.workout?.lastHeardFromPhone == later)
  }
}
