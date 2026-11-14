import Foundation
import RideData
import Testing

@testable import RideCore

struct RampTestTests {
  private static let largestEstimateError = 0.12

  @Test func stepsUpBySixPercentOfFTPEveryMinuteFromHalfOfIt() throws {
    let test = RampTest(ftp: 250)
    #expect(test.firstStepWatts == 125)
    #expect(test.stepWatts == 15)
    let planned = test.planned
    let ramp = try #require(planned.rampSteps)
    #expect(ramp.count == RampTest.mostSteps)
    #expect(planned.steps[ramp.lowerBound].target == .watts(.constant(125)))
    #expect(planned.steps[ramp.lowerBound + 1].target == .watts(.constant(140)))
    #expect(planned.steps.last?.name == "Cool-down")
  }

  @Test func assumesAnFTPWhenTheRiderHasNone() {
    #expect(RampTest(ftp: nil).ftp == RampTest.assumedFTP)
  }

  @Test(arguments: [150, 250, 350])
  func endsWhereATypicalRiderCracksAndEstimatesTheirThreshold(ftp: Int) throws {
    let rider = RiderPhysiology.typical(ftp: ftp)
    let outcome = HeadlessRide(RampTest(ftp: ftp).planned, ftp: ftp).run(
      with: SimulatedRider(rider))
    let ended = try #require(outcome.engine.rampEndedAt)
    #expect(outcome.engine.session.isComplete)
    #expect(abs(outcome.engine.session.elapsed - ended - RampTest.coolDownSeconds) <= 1)
    let result = try #require(RampTestResult(outcome.engine.session.recording()))
    let error = Double(result.ftp) / rider.criticalPowerWatts - 1
    #expect(abs(error) <= Self.largestEstimateError)
  }

  @Test func endsTenSecondsAfterTheRiderStopsPedalling() throws {
    var engine = rampEngine()
    let start = rampStart(of: engine)
    for second in 0..<Int(start) + 90 {
      engine.apply(tick(power: second < Int(start) + 60 ? target(of: engine) : 0))
    }
    let ended = try #require(engine.rampEndedAt)
    #expect(ended == start + 60 + RampTest.endsAfterSecondsBelow)
    #expect(engine.session.currentInterval?.step.name == "Cool-down")
  }

  @Test func aFewSecondsBelowTheTargetDoNotEndIt() {
    var engine = rampEngine()
    let start = Int(rampStart(of: engine))
    for second in 0..<start + 120 {
      let easing = (start + 30..<start + 39).contains(second)
      engine.apply(tick(power: easing ? 0 : target(of: engine)))
    }
    #expect(engine.rampEndedAt == nil)
  }

  @Test func aPauseDoesNotCountTowardTheEnd() {
    var engine = rampEngine()
    let start = Int(rampStart(of: engine))
    for _ in 0..<start + 30 { engine.apply(tick(power: target(of: engine))) }
    engine.apply(.togglePause)
    for _ in 0..<60 { engine.apply(tick(power: 0)) }
    #expect(engine.rampEndedAt == nil)
  }

  @Test func replayingTheInputsEndsTheRampAtTheSameMoment() {
    let rider = RiderPhysiology.typical(ftp: 250)
    let outcome = HeadlessRide(RampTest(ftp: 250).planned, ftp: 250).run(
      with: SimulatedRider(rider))
    let replayed = RideEngine(
      replaying: outcome.trace.inputs, from: outcome.trace.freshSession())
    #expect(replayed.rampEndedAt == outcome.engine.rampEndedAt)
    #expect(replayed.session.recording() == outcome.engine.session.recording())
  }

  @Test func estimatesFTPAsThreeQuartersOfTheBestMinute() throws {
    var engine = RideEngine(
      session: RideSession(
        workout: Workout(name: "Any", steps: [.init(duration: 600, targetPower: 200)]),
        startDate: .distantPast))
    engine.apply(.begin(trainerConnected: true))
    for second in 0..<300 {
      let power = (100..<160).contains(second) ? 400 : 150
      engine.apply(
        .tick(
          seconds: 1, reading: TrainerReading(power: power, heartRate: 120 + second / 10),
          trainerConnected: true))
    }
    let result = try #require(RampTestResult(engine.session.recording()))
    #expect(result.bestMinuteWatts == 400)
    #expect(result.ftp == 300)
    #expect(result.maxHeartRate == 149)
  }

  private func rampEngine() -> RideEngine {
    var engine = RideEngine(
      session: RideSession(
        workout: RampTest(ftp: 250).planned.workout(ftp: 250), startDate: .distantPast))
    engine.apply(.begin(trainerConnected: true))
    return engine
  }

  private func rampStart(of engine: RideEngine) -> TimeInterval {
    RampTest.warmUp.map(\.seconds).reduce(0, +)
  }

  private func target(of engine: RideEngine) -> Int {
    engine.session.targetPower ?? 0
  }

  private func tick(power: Int) -> RideInput {
    .tick(seconds: 1, reading: TrainerReading(power: power, cadence: 90), trainerConnected: true)
  }
}
