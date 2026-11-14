import Foundation
import RideData
import Testing

@testable import RideCore

struct LibraryWorkoutRideTests {
  private let ftp = 250

  private let workout = TrainStackWorkout(
    name: "Ramps and nested repeats", sport: .cycling, focus: .threshold,
    blocks: [
      .step(
        .init(
          duration: .seconds(300), target: .power(unit: "ftp", level: .ramp(from: 0.4, to: 0.8)))),
      .repeat(
        .init(
          count: 2,
          blocks: [
            .step(
              .init(duration: .seconds(120), target: .power(unit: "ftp", level: .constant(0.95)))),
            .repeat(
              .init(
                count: 3,
                blocks: [
                  .step(
                    .init(
                      duration: .seconds(20), target: .power(unit: "watts", level: .constant(400)),
                      cadence: .constant(105))),
                  .step(.init(duration: .seconds(40))),
                ])),
          ], cues: [.init(at: .seconds(0), text: "Main set")])),
      .step(.init(duration: .seconds(15), target: .maxEffort)),
      .step(
        .init(
          duration: .seconds(300), target: .power(unit: "ftp", level: .ramp(from: 0.6, to: 0.4)))),
    ])

  private var planned: PlannedWorkout {
    get throws { try #require(workout.rideability.planned) }
  }

  @Test func ridesALibraryWorkoutFromStartToFinish() throws {
    let planned = try planned
    let outcome = HeadlessRide(planned, ftp: ftp).run(with: SimulatedRider(.typical(ftp: ftp)))
    let session = outcome.engine.session
    #expect(session.isComplete)
    #expect(session.elapsed == planned.duration)
    let targets = session.samples.map(\.sample.targetPower)
    #expect(targets[0] == 100)
    #expect(targets[150] == 150)
    #expect(targets[299] == 200)
    #expect(targets[300] == 238)
    #expect(targets[420] == 400)
    #expect(targets[440] == nil)
    let decoded = try FITDecoder.decode(FITEncoder.encode(session.recording()))
    #expect(decoded.samples.map(\.targetPower) == targets)
  }

  @Test func theTraceKeepsTheWorkoutTheRideStartedWith() throws {
    let outcome = HeadlessRide(try planned, ftp: ftp).run(with: SimulatedRider(.typical(ftp: ftp)))
    let trace = try #require(RideTrace(jsonLines: try outcome.trace.jsonLines()))
    #expect(trace.header.workout == (try planned))
    #expect(trace.replay().session.recording() == outcome.engine.session.recording())
  }

  @Test func readsATraceRecordedBeforeWorkoutsCameFromTheLibrary() throws {
    let template = try #require(WorkoutTemplate.named("Quick test 45s"))
    let header = """
      {"ftp":200,"riderWeight":75,"startDate":0,"template":\
      \(String(decoding: try JSONEncoder().encode(template), as: UTF8.self))}
      """
    let trace = try #require(RideTrace(jsonLines: Data((header + "\n").utf8)))
    #expect(trace.header.workout == template.planned)
    #expect(trace.freshSession().workout == template.workout(ftp: 200))
  }
}
