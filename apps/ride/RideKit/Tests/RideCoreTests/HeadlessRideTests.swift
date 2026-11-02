import Foundation
import RideData
import Testing

@testable import RideCore

struct HeadlessRideTests {
  private let ftp = 250

  @Test(arguments: WorkoutTemplate.library)
  func ridesEveryWorkoutFromStartToFinish(_ template: WorkoutTemplate) throws {
    let outcome = HeadlessRide(template, ftp: ftp).run(with: SimulatedRider(.typical(ftp: ftp)))
    let session = outcome.engine.session
    #expect(session.isComplete)
    #expect(session.elapsed == template.duration)
    #expect(session.samples.count == Int(template.duration))
    let decoded = try FITDecoder.decode(FITEncoder.encode(session.recording()))
    #expect(decoded.samples.count == session.samples.count)
    #expect(decoded.summary.duration == session.elapsed)
  }

  @Test func aTrainerDropMidIntervalPausesTheRideUntilTheRiderResumes() {
    let template = WorkoutTemplate.named("Threshold classic 60")!
    let dropAt = 1_500
    let dropSeconds = 40
    let outcome = HeadlessRide(
      template, ftp: ftp, events: [dropAt: [.trainerDrops(forSeconds: dropSeconds)]]
    ).run(with: SimulatedRider(.typical(ftp: ftp)))
    let session = outcome.engine.session
    let waited = dropSeconds + HeadlessRide.resumeDelayAfterReconnectSeconds
    #expect(session.isComplete)
    #expect(session.elapsed == template.duration)
    #expect(outcome.trace.inputs.count(where: Self.isTick) == Int(template.duration) + waited)
    #expect(!session.samples.contains { $0.sample.power == nil })
  }

  @Test func theSameRiderAndEventsGiveTheSameTrace() throws {
    let template = try #require(WorkoutTemplate.named("Over-unders 2×10"))
    let ride = HeadlessRide(
      template, ftp: ftp,
      events: [120: [.rider(.changeMode(.slope))], 400: [.trainerDrops(forSeconds: 20)]])
    let first = ride.run(with: SimulatedRider(.typical(ftp: ftp), seed: 3))
    let second = ride.run(with: SimulatedRider(.typical(ftp: ftp), seed: 3))
    #expect(try first.trace.jsonLines() == second.trace.jsonLines())
    #expect(first.trace.replay().session.recording() == first.engine.session.recording())
  }

  private static func isTick(_ input: RideInput) -> Bool {
    if case .tick = input { true } else { false }
  }
}
