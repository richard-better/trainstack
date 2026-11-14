import Foundation
import Testing

@testable import RideData

struct LapStepTests {
  private let workout = PlannedWorkout(
    name: "Laps", category: nil,
    steps: [
      PlannedStep(duration: 60, target: .watts(.constant(150))),
      PlannedStep(
        duration: 0, target: .watts(.range(low: 240, high: 260)),
        cues: [PlannedCue(at: 30, text: "Settle in"), PlannedCue(at: 400, text: "Halfway")],
        untilLap: UntilLap(expectedSeconds: 600)),
      PlannedStep(duration: 120, target: .watts(.constant(100))),
      PlannedStep(duration: 0, target: nil, untilLap: UntilLap()),
    ])

  private func ride(_ session: inout RideSession, seconds: Int) {
    for _ in 0..<seconds { session.advance(by: 1, reading: .init(power: 200)) }
  }

  @Test func holdsTheTargetAndCountsUpUntilTheRiderLaps() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 60)
    #expect(session.currentInterval?.index == 1)
    #expect(session.awaitsLap)
    ride(&session, seconds: 1500)
    #expect(session.currentInterval?.index == 1)
    #expect(session.targetPower == 250)
    #expect(session.intervalElapsed == 1500)
    #expect(session.intervalRemaining == nil)
    #expect(session.hasLapStepsAhead)
    session.skipInterval()
    #expect(session.currentInterval?.index == 2)
    #expect(session.currentInterval?.start == 1560)
    #expect(session.targetPower == 100)
    #expect(session.intervalRemaining == 120)
  }

  @Test func neverEndsAStepOnItsExpectedLength() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 60 + 600 + 10)
    #expect(session.currentInterval?.index == 1)
    #expect(!session.isComplete)
  }

  @Test func showsACueOnlyIfTheRiderReachesIt() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 60 + 30)
    #expect(session.cue?.text == "Settle in")
    ride(&session, seconds: 300)
    session.skipInterval()
    ride(&session, seconds: 30)
    #expect(session.cue == nil)
  }

  @Test func endsOnTheLastLapAndKeepsTheLengthsRidden() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 100)
    session.skipInterval()
    ride(&session, seconds: 120)
    #expect(session.awaitsLap)
    #expect(session.targetPower == nil)
    ride(&session, seconds: 45)
    #expect(!session.hasLapStepsAhead || session.awaitsLap)
    session.skipInterval()
    #expect(session.isComplete)
    #expect(session.duration == 60 + 40 + 120 + 45)
    #expect(session.position == session.duration)
    #expect(session.intervals.map { $0.end - $0.start } == [60, 40, 120, 45])
  }

  @Test func skippingATimedStepStillJumpsToItsEnd() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 10)
    session.skipInterval()
    #expect(session.position == 60)
    #expect(session.awaitsLap)
  }

  @Test func countsOnlyTheTimedStepsAsTheTimeLeft() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    #expect(session.remaining == 180)
    ride(&session, seconds: 20)
    #expect(session.remaining == 160)
    ride(&session, seconds: 40)
    #expect(session.remaining == 120)
    ride(&session, seconds: 100)
    #expect(session.remaining == 120)
  }

  @Test func keepsShowingAReachedCueWhenALaterOneWasNotReached() {
    let workout = PlannedWorkout(
      name: "Cues", category: nil,
      steps: [
        PlannedStep(
          duration: 0, target: nil,
          cues: [
            PlannedCue(at: 5, text: "Reached", shownFor: 30),
            PlannedCue(at: 15, text: "Not reached", shownFor: 30),
          ], untilLap: UntilLap()),
        PlannedStep(duration: 60, target: nil),
      ])
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 10)
    session.skipInterval()
    ride(&session, seconds: 10)
    #expect(session.cue?.text == "Reached")
  }
}
