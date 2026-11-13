import Foundation
import RideData
import Testing

@testable import RideCore

struct RideEngineTests {
  private let template = WorkoutTemplate.named("Threshold classic 60")!

  private func engine() -> RideEngine {
    RideEngine(session: RideSession(workout: template.workout(ftp: 250), startDate: .distantPast))
  }

  private func tick(power: Int = 200, connected: Bool = true) -> RideInput {
    .tick(seconds: 1, reading: .init(power: power, cadence: 90), trainerConnected: connected)
  }

  @Test func pausesWhenAConnectedTrainerDropsAndOnlyTheRiderResumes() {
    var engine = engine()
    engine.apply(.begin(trainerConnected: true))
    engine.apply(tick())
    engine.apply(tick(connected: false))
    #expect(engine.isPausedForTrainer)
    engine.apply(tick(connected: true))
    #expect(engine.session.isPaused)
    #expect(engine.session.elapsed == 1)
    engine.apply(.togglePause)
    engine.apply(tick())
    #expect(!engine.isPausedForTrainer)
    #expect(engine.session.elapsed == 2)
  }

  @Test func aTrainerThatNeverConnectedDoesNotPauseTheRide() {
    var engine = engine()
    engine.apply(.begin(trainerConnected: false))
    for _ in 0..<3 { engine.apply(tick(connected: false)) }
    #expect(!engine.session.isPaused)
    #expect(engine.session.elapsed == 3)
  }

  @Test func aResumedRideWaitsPausedForTheRider() {
    var engine = engine()
    engine.apply(.begin(trainerConnected: true))
    engine.apply(tick())
    engine.apply(.resumeAfterCrash(trainerConnected: true))
    engine.apply(tick())
    #expect(engine.session.isPaused)
    #expect(engine.session.samples.count == 1)
  }

  @Test func returnsTheSampleEachTickRecords() {
    var engine = engine()
    engine.apply(.begin(trainerConnected: true))
    #expect(engine.apply(tick(power: 180))?.sample.power == 180)
    engine.apply(.togglePause)
    #expect(engine.apply(tick()) == nil)
  }

  @Test func asksTheTrainerForTheCurrentModesSetting() {
    var engine = engine()
    let firstTarget = template.workout(ftp: 250).steps[0].targetPower
    #expect(engine.trainerCommand == .power(watts: firstTarget))
    engine.apply(.changeMode(.slope))
    engine.apply(.adjust(steps: 2))
    #expect(engine.trainerCommand == .grade(percent: 3))
    engine.apply(.changeMode(.level))
    #expect(engine.trainerCommand == .resistance(shareOfRange: 0.3))
  }

  @Test func asksForAFlatRoadOnceTheWorkoutIsOver() {
    var engine = engine()
    while !engine.session.isComplete { engine.apply(.skipInterval) }
    #expect(engine.trainerCommand == .grade(percent: 0))
  }

  @Test func replayingTheInputsRebuildsTheSameRide() {
    var live = engine()
    var inputs: [RideInput] = [.begin(trainerConnected: true)]
    for second in 0..<600 {
      inputs.append(tick(power: 150 + second % 90, connected: !(300..<320).contains(second)))
      if second == 330 { inputs.append(.togglePause) }
      if second == 400 { inputs.append(.changeMode(.slope)) }
      if second == 450 { inputs.append(.adjust(steps: 4)) }
    }
    for input in inputs { live.apply(input) }
    let replayed = RideEngine(replaying: inputs, from: engine().session)
    #expect(replayed.session.recording() == live.session.recording())
    #expect(replayed.session.speedMetresPerSecond == live.session.speedMetresPerSecond)
  }
}
