import Foundation
import Testing

@testable import RideData

struct PlannedWorkoutTests {
  private let planned = PlannedWorkout(
    name: "Every target", category: .threshold,
    steps: [
      PlannedStep(duration: 100, target: .shareOfFTP(.ramp(from: 0.5, to: 1))),
      PlannedStep(duration: 60, target: .shareOfFTP(.range(low: 0.9, high: 1.1))),
      PlannedStep(duration: 30, target: .watts(.constant(400)), cadence: .constant(110)),
      PlannedStep(
        duration: 60, target: nil,
        cues: [
          PlannedCue(at: 5, text: "Spin easy"), PlannedCue(at: 30, text: "Get ready", shownFor: 5),
        ]),
      PlannedStep(duration: 20, target: .maxEffort),
      PlannedStep(duration: 60, target: .beatsPerMinute(.range(low: 140, high: 150))),
    ])

  private func ride(_ session: inout RideSession, seconds: Int) {
    for _ in 0..<seconds { session.advance(by: 1, reading: .init(power: 150)) }
  }

  @Test func aBuiltInPlaysTheWattsItAlwaysHas() throws {
    for template in WorkoutTemplate.library {
      let before = template.steps.map { Int((Double(250) * $0.intensity).rounded()) }
      let after = template.planned.workout(ftp: 250).steps.map { $0.targetPower(atOffset: 0) }
      #expect(after == before, "\(template.name)")
      #expect(template.planned.duration == template.duration)
    }
  }

  @Test func ergFollowsARampSecondBySecond() {
    var session = RideSession(workout: planned.workout(ftp: 200))
    #expect(session.targetPower == 100)
    ride(&session, seconds: 50)
    #expect(session.targetPower == 150)
    ride(&session, seconds: 49)
    #expect(session.targetPower == 199)
    let targets = session.samples.map(\.sample.targetPower)
    #expect(targets.prefix(3) == [100, 101, 102])
  }

  @Test func ergHoldsTheMiddleOfARange() {
    var session = RideSession(workout: planned.workout(ftp: 200))
    ride(&session, seconds: 100)
    #expect(session.targetPower == 200)
  }

  @Test func wattsStayWattsWhateverTheFTP() {
    var session = RideSession(workout: planned.workout(ftp: 320))
    ride(&session, seconds: 160)
    #expect(session.targetPower == 400)
    #expect(session.currentInterval?.step.cadence == .constant(110))
  }

  @Test func theRidersErgAdjustmentScalesEveryPowerTarget() {
    var session = RideSession(workout: planned.workout(ftp: 200))
    session.adjust(by: -10)
    #expect(session.targetPower == 90)
    ride(&session, seconds: 160)
    #expect(session.targetPower == 360)
  }

  @Test func freeRideMaxEffortAndHeartRateSetNoPower() {
    var session = RideSession(workout: planned.workout(ftp: 200))
    ride(&session, seconds: 190)
    #expect(session.currentInterval?.step.target == nil)
    #expect(session.targetPower == nil)
    ride(&session, seconds: 60)
    #expect(session.currentInterval?.step.target == .maxEffort)
    #expect(session.currentInterval?.zone(ftp: 200) == .anaerobic)
    #expect(session.targetPower == nil)
    ride(&session, seconds: 20)
    #expect(
      session.currentInterval?.step.target
        == .heartRate(.beatsPerMinute(.range(low: 140, high: 150))))
    #expect(session.targetPower == nil)
    #expect(session.currentInterval?.zone(ftp: 200) == nil)
  }

  @Test func showsEachCueFromItsOffsetForItsTime() {
    var session = RideSession(workout: planned.workout(ftp: 200))
    ride(&session, seconds: 190 + 4)
    #expect(session.cue == nil)
    ride(&session, seconds: 1)
    #expect(session.cue?.text == "Spin easy")
    ride(&session, seconds: PlannedCue.defaultShownFor.asSeconds - 1)
    #expect(session.cue?.text == "Spin easy")
    ride(&session, seconds: 1)
    #expect(session.cue == nil)
    ride(&session, seconds: 15)
    #expect(session.cue?.text == "Get ready")
    ride(&session, seconds: 5)
    #expect(session.cue == nil)
  }

  @Test func resolvesAShareOfThresholdHeartRateForDisplayOnly() {
    let step = PlannedStep(duration: 60, target: .shareOfThresholdHeartRate(.constant(0.85)))
    #expect(step.resolved(ftp: 250).target == .heartRate(.shareOfThreshold(.constant(0.85))))
  }

  @Test func aCueNearTheEndOfAStepShowsForItsWholeTimeIntoTheNext() {
    let workout = PlannedWorkout(
      name: "Cue", category: nil,
      steps: [
        PlannedStep(duration: 60, target: nil, cues: [PlannedCue(at: 55, text: "Up next: sprint")]),
        PlannedStep(duration: 60, target: .watts(.constant(400))),
      ])
    var session = RideSession(workout: workout.workout(ftp: 200))
    ride(&session, seconds: 55)
    #expect(session.cue?.text == "Up next: sprint")
    ride(&session, seconds: 9)
    #expect(session.currentInterval?.index == 1)
    #expect(session.cue?.text == "Up next: sprint")
    ride(&session, seconds: 1)
    #expect(session.cue == nil)
  }

  @Test func ergHoldsTheRoundedMiddleOfAFractionalRange() {
    let workout = PlannedWorkout(
      name: "Fractions", category: nil,
      steps: [PlannedStep(duration: 60, target: .watts(.range(low: 125.1, high: 125.6)))])
    #expect(RideSession(workout: workout.workout(ftp: 200)).targetPower == 125)
  }

  @Test func aBuiltInsStepIsInTheZoneOfTheWattsItAsksFor() throws {
    let openers = try #require(WorkoutTemplate.named("Ramp openers 30"))
    let ftp = 249
    let session = RideSession(workout: openers.planned.workout(ftp: ftp))
    for (interval, step) in zip(session.intervals, openers.steps) {
      let watts = Int((Double(ftp) * step.intensity).rounded())
      #expect(interval.zone(ftp: ftp) == PowerZone.zone(power: watts, ftp: ftp))
    }
  }
}

extension TimeInterval {
  fileprivate var asSeconds: Int { Int(self) }
}
