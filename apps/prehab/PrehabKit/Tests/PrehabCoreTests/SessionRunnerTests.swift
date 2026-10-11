import Foundation
import Testing

@testable import PrehabCore

struct SessionRunnerTests {
  private func exercise(sets: Int = 2, side: String = "bilateral", duration: Int? = nil)
    -> SessionsGetByIdOutputExercisesItem
  {
    .init(
      id: "bridge", name: "Bridge", sets: sets, reps: duration == nil ? 10 : nil,
      durationSec: duration, restSec: 20, side: side, formCues: [], videoUrl: "")
  }
  @Test func leftAndRightFinishBeforeRest() {
    var runner = SessionRunner(exercises: [exercise(side: "left_right")])
    runner.advance()
    #expect(runner.isRightSide)
    #expect(runner.set == 1)
    runner.advance()
    #expect(runner.phase == .rest)
    #expect(runner.set == 2)
    runner.advance()
    #expect(runner.phase == .exercise)
    runner.advance()
    runner.advance()
    #expect(runner.phase == .finished)
    #expect(runner.completed == [0])
  }
  @Test func pausePreservesTimeAcrossBackgrounding() {
    let start = Date(timeIntervalSince1970: 100)
    var runner = SessionRunner(exercises: [exercise(duration: 30)])
    runner.start(now: start)
    runner.pause(now: start.addingTimeInterval(8))
    runner.tick(now: start.addingTimeInterval(600))
    #expect(runner.remaining == 22)
    runner.start(now: start.addingTimeInterval(600))
    runner.tick(now: start.addingTimeInterval(623))
    #expect(runner.phase == .rest)
    #expect(runner.remaining == 20)
  }
  @Test func skipsDoNotCountAsCompleted() {
    var runner = SessionRunner(exercises: Array(repeating: exercise(sets: 1), count: 5))
    runner.skip()
    runner.skip()
    runner.advance()
    runner.advance()
    runner.advance()
    #expect(runner.phase == .finished)
    #expect(!runner.canComplete)
    #expect(runner.completed == [2, 3, 4])
    #expect(runner.skipped == [0, 1])
  }
  @Test func fourOfFiveExercisesQualify() {
    var runner = SessionRunner(exercises: Array(repeating: exercise(sets: 1), count: 5))
    runner.skip()
    for _ in 0..<4 { runner.advance() }
    #expect(runner.canComplete)
  }
  @Test func checkpointRoundTrips() throws {
    var runner = SessionRunner(exercises: [exercise(side: "left_right")])
    runner.advance()
    let restored = try JSONDecoder().decode(SessionRunner.self, from: JSONEncoder().encode(runner))
    #expect(restored == runner)
    #expect(restored.isRightSide)
  }
  @Test func serverResumePreservesSkippedExercises() {
    let runner = SessionRunner(
      exercises: Array(repeating: exercise(sets: 1), count: 5), resumeAfter: 4, skipped: [0, 1])
    #expect(runner.phase == .finished)
    #expect(runner.completed == [2, 3, 4])
    #expect(!runner.canComplete)
  }
  @Test func timerContinuesThroughRestAndTheNextSet() {
    let start = Date(timeIntervalSince1970: 100)
    var runner = SessionRunner(exercises: [exercise(duration: 30)])
    runner.start(now: start)
    runner.tick(now: start.addingTimeInterval(30))
    #expect(runner.phase == .rest)
    #expect(!runner.isPaused)
    runner.tick(now: start.addingTimeInterval(50))
    #expect(runner.phase == .exercise)
    #expect(runner.set == 2)
    #expect(runner.deadline == start.addingTimeInterval(80))
  }
  @Test func emptySessionCannotComplete() { #expect(!SessionRunner(exercises: []).canComplete) }
  @Test func dayUsesTheUsersTimezone() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: -8 * 3600)!
    #expect(LocalDay.string(Date(timeIntervalSince1970: 0), calendar: calendar) == "1969-12-31")
  }
}
