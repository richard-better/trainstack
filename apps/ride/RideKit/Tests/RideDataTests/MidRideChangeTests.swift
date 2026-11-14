import Foundation
import Testing

@testable import RideData

struct MidRideChangeTests {
  private let workout = PlannedWorkout(
    name: "Three steps", category: nil,
    steps: [
      PlannedStep(duration: 60, target: .watts(.constant(150))),
      PlannedStep(duration: 120, target: .watts(.ramp(from: 200, to: 300))),
      PlannedStep(duration: 60, target: .watts(.constant(100))),
    ])

  private func ride(_ session: inout RideSession, seconds: Int) {
    for _ in 0..<seconds { session.advance(by: 1, reading: .init(power: 200)) }
  }

  private func laps(_ session: RideSession) -> [(duration: Double, step: Int?)] {
    session.recording().laps.map { ($0.duration, $0.stepIndex) }
  }

  @Test func addingTimeLengthensTheCurrentIntervalAndTheWorkout() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 70)
    session.extendInterval(by: 60)
    #expect(session.currentInterval?.end == 240)
    #expect(session.duration == 300)
    #expect(session.intervalRemaining == 170)
    ride(&session, seconds: 230)
    #expect(session.isComplete)
    #expect(laps(session).map(\.duration) == [60, 180, 60])
    #expect(laps(session).map(\.step) == [0, 1, 2])
    #expect(session.recording().laps.map(\.trigger) == [.time, .time, .time])
  }

  @Test func anExtendedRampHoldsItsLastTargetUntilTheAddedTimeIsUp() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 70)
    session.extendInterval(by: 60)
    ride(&session, seconds: 110)
    #expect(session.targetPower == 300)
    ride(&session, seconds: 59)
    #expect(session.targetPower == 300)
    ride(&session, seconds: 1)
    #expect(session.targetPower == 100)
  }

  @Test func addingTimeToTheCoolDownPutsOffTheEnd() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 230)
    session.extendInterval(by: 120)
    ride(&session, seconds: 100)
    #expect(!session.isComplete)
    ride(&session, seconds: 30)
    #expect(session.isComplete)
    #expect(laps(session).last?.duration == 180)
  }

  @Test func noTimeIsAddedToALapButtonStepOrAfterTheEnd() {
    var laps = RideSession(
      workout: PlannedWorkout(
        name: "Lap", category: nil,
        steps: [PlannedStep(duration: 0, target: nil, untilLap: UntilLap())]
      ).workout(ftp: 250))
    laps.extendInterval(by: 60)
    #expect(!laps.canExtendInterval)
    var done = RideSession(workout: workout.workout(ftp: 250))
    ride(&done, seconds: 250)
    done.extendInterval(by: 60)
    #expect(done.isComplete)
    #expect(done.duration == 240)
  }

  @Test func goingBackRidesThePreviousIntervalAgainAndThenThisOne() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 90)
    session.previousInterval()
    #expect(session.currentInterval?.stepIndex == 0)
    #expect(session.targetPower == 150)
    #expect(session.intervalRemaining == 60)
    ride(&session, seconds: 60)
    #expect(session.currentInterval?.stepIndex == 1)
    #expect(session.intervalRemaining == 120)
    ride(&session, seconds: 180)
    #expect(session.isComplete)
    #expect(laps(session).map(\.step) == [0, 1, 0, 1, 2])
    #expect(laps(session).map(\.duration) == [60, 30, 60, 120, 60])
    #expect(session.recording().laps.map(\.trigger) == [.time, .manual, .time, .time, .time])
  }

  @Test func goingBackTwiceAtOnceGoesBackTwoIntervals() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 200)
    session.previousInterval()
    session.previousInterval()
    #expect(session.currentInterval?.stepIndex == 0)
    ride(&session, seconds: 60)
    #expect(session.currentInterval?.stepIndex == 1)
    ride(&session, seconds: 125)
    #expect(session.currentInterval?.stepIndex == 2)
    #expect(laps(session).map(\.step) == [0, 1, 2, 0, 1, 2])
  }

  @Test func goingBackInTheFirstIntervalStartsItAgain() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 30)
    session.previousInterval()
    #expect(session.currentInterval?.stepIndex == 0)
    #expect(session.intervalRemaining == 60)
    #expect(session.elapsed == 30)
  }

  @Test func goingBackAfterTheEndRidesTheLastIntervalAgain() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 260)
    session.previousInterval()
    #expect(session.currentInterval?.stepIndex == 2)
    #expect(session.targetPower == 100)
    ride(&session, seconds: 60)
    #expect(session.isComplete)
    #expect(laps(session).map(\.step) == [0, 1, 2, nil, 2])
  }

  @Test func ridingOnAfterTheEndKeepsRecordingAsAFreeRide() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 240)
    #expect(session.freeRideElapsed == 0)
    ride(&session, seconds: 300)
    #expect(session.isComplete)
    #expect(session.freeRideElapsed == 300)
    #expect(session.elapsed == 540)
    #expect(session.targetPower == nil)
    #expect(session.recording().summary.duration == 540)
    #expect(laps(session).last?.duration == 300)
  }

  @Test func ridingNeverChangesThePlannedWorkout() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 70)
    session.extendInterval(by: 60)
    session.previousInterval()
    ride(&session, seconds: 400)
    #expect(session.workout == workout.workout(ftp: 250))
  }

  @Test func goingBackToALapButtonStepWaitsForTheLapAgain() {
    var session = RideSession(
      workout: PlannedWorkout(
        name: "Laps", category: nil,
        steps: [
          PlannedStep(duration: 0, target: .watts(.constant(250)), untilLap: UntilLap()),
          PlannedStep(duration: 60, target: .watts(.constant(100))),
        ]
      ).workout(ftp: 250))
    ride(&session, seconds: 40)
    session.markLap()
    ride(&session, seconds: 10)
    session.previousInterval()
    #expect(session.awaitsLap)
    ride(&session, seconds: 100)
    #expect(session.awaitsLap)
    session.markLap()
    ride(&session, seconds: 60)
    #expect(laps(session).map(\.duration) == [40, 10, 100, 60])
    #expect(laps(session).map(\.step) == [0, 1, 0, 1])
  }
}
