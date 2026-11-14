import Foundation
import RideData
import Testing

@testable import RideCore

struct LapStepReplayTests {
  @Test func aRideWithLapsReplaysToTheSameRecording() throws {
    let workout = PlannedWorkout(
      name: "Laps", category: nil,
      steps: [
        PlannedStep(duration: 30, target: .watts(.constant(150))),
        PlannedStep(duration: 0, target: .watts(.constant(250)), untilLap: UntilLap()),
        PlannedStep(duration: 30, target: .watts(.constant(120))),
      ])
    let ride = HeadlessRide(
      workout, ftp: 250, events: [95: [.rider(.skipInterval)]])
    let outcome = ride.run(with: SimulatedRider(.typical(ftp: 250)))
    #expect(outcome.engine.session.isComplete)
    #expect(outcome.engine.session.elapsed == 125)
    let trace = try #require(RideTrace(jsonLines: try outcome.trace.jsonLines()))
    #expect(trace.header.workout == workout)
    #expect(trace.replay().session.recording() == outcome.engine.session.recording())
  }

  @Test func lapsTheRiderMarkedComeBackWhenACrashedRideIsRecovered() throws {
    let ride = HeadlessRide(
      WorkoutTemplate.named("Recovery 30")!.fitted(to: 300), ftp: 220,
      events: [40: [.rider(.markLap)], 100: [.rider(.markLap)]])
    let outcome = ride.run(with: SimulatedRider(.typical(ftp: 220)))
    let cut = try #require(outcome.trace.inputs.lastIndex(of: .markLap))
    var crashed = outcome.trace
    crashed.inputs = Array(outcome.trace.inputs[...cut])
    let recovered = try #require(InterruptedRide(trace: crashed))
    var engine = recovered.engine
    engine.apply(.resumeAfterCrash(trainerConnected: true))
    #expect(engine.session.isPaused)
    engine.apply(.togglePause)
    for input in outcome.trace.inputs[(cut + 1)...] { engine.apply(input) }
    #expect(engine.session.recording().laps == outcome.engine.session.recording().laps)
    #expect(engine.session.lapMarks.filter { $0.endedBy == .manual }.count == 2)
  }

  @Test func aHeadlessRideRidesOnForAllTheTimeItWasGiven() {
    let outcome = HeadlessRide(.named("Quick test 45s")!, ftp: 250, ridingOnFor: 120)
      .run(with: SimulatedRider(.typical(ftp: 250)))
    #expect(outcome.engine.session.elapsed == 165)
    #expect(outcome.engine.session.freeRideElapsed == 120)
  }

  @Test func aRideFromTheSimulatorWithEveryMidRideControlKeepsPlanAndRideApart() throws {
    let traces = URL(filePath: #filePath).deletingLastPathComponent().appending(path: "Traces")
    let data = try Data(
      contentsOf: traces.appending(path: "simulator-lap-extend-back-ride-on.jsonl"))
    let trace = try #require(RideTrace(jsonLines: data))
    #expect(trace.header.workout == WorkoutTemplate.named("Quick test 45s")!.planned)
    let decoded = try FITDecoder.decode(FITEncoder.encode(trace.replay().session.recording()))
    #expect(decoded.laps.map(\.stepIndex) == [0, 1, 1, 2, 1, 2, nil])
    #expect(
      decoded.laps.map(\.trigger) == [.time, .manual, .time, .manual, .time, .time, .sessionEnd])
    #expect(decoded.utcOffsetSeconds == 3600)
  }
}
