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
}
