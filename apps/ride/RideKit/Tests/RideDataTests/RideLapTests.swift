import Foundation
import Testing

@testable import RideData

struct RideLapTests {
  private let workout = PlannedWorkout(
    name: "Three steps", category: nil,
    steps: [
      PlannedStep(duration: 60, target: .watts(.constant(150))),
      PlannedStep(duration: 120, target: .watts(.constant(250))),
      PlannedStep(duration: 60, target: .watts(.constant(100))),
    ])

  private func ride(_ session: inout RideSession, seconds: Int, power: Int = 200) {
    for _ in 0..<seconds {
      session.advance(by: 1, reading: .init(power: power, cadence: 90, heartRate: 140))
    }
  }

  private func laps(_ session: RideSession) -> [(start: Double, duration: Double, step: Int?)] {
    session.recording().laps.map { ($0.start, $0.duration, $0.stepIndex) }
  }

  @Test func eachIntervalIsALapByItself() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 240)
    let laps = session.recording().laps
    #expect(laps.map(\.start) == [0, 60, 180])
    #expect(laps.map(\.duration) == [60, 120, 60])
    #expect(laps.map(\.stepIndex) == [0, 1, 2])
    #expect(laps.map(\.trigger) == [.time, .time, .time])
  }

  @Test func aLapTheRiderMarksSplitsTheIntervalAndBothHalvesKeepItsStep() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 100)
    session.markLap()
    ride(&session, seconds: 140)
    #expect(laps(session).map(\.start) == [0, 60, 100, 180])
    #expect(laps(session).map(\.step) == [0, 1, 1, 2])
    #expect(session.recording().laps.map(\.trigger) == [.time, .manual, .time, .time])
  }

  @Test func aSecondLapAtTheSameMomentAddsNoEmptyLap() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 30)
    session.markLap()
    session.markLap()
    ride(&session, seconds: 210)
    #expect(laps(session).map(\.start) == [0, 30, 60, 180])
  }

  @Test func ridingOnPastTheEndIsALapWithNoStep() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 300)
    let last = session.recording().laps.last
    #expect(last?.start == 240)
    #expect(last?.duration == 60)
    #expect(last?.stepIndex == nil)
    #expect(last?.trigger == .sessionEnd)
  }

  @Test func aSkippedIntervalIsALapAsLongAsItWasRiddenAndEndedByTheRider() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 90)
    session.skipInterval()
    ride(&session, seconds: 60)
    let laps = session.recording().laps
    #expect(laps.map(\.start) == [0, 60, 90])
    #expect(laps.map(\.stepIndex) == [0, 1, 2])
    #expect(laps.map(\.trigger) == [.time, .manual, .time])
  }

  @Test func aLapOnALapButtonStepEndsTheStep() {
    let laps = PlannedWorkout(
      name: "Laps", category: nil,
      steps: [
        PlannedStep(duration: 0, target: nil, untilLap: UntilLap()),
        PlannedStep(duration: 60, target: .watts(.constant(100))),
      ])
    var session = RideSession(workout: laps.workout(ftp: 250))
    ride(&session, seconds: 45)
    session.markLap()
    #expect(session.currentInterval?.index == 1)
    ride(&session, seconds: 60)
    #expect(self.laps(session).map(\.duration) == [45, 60])
    #expect(session.recording().laps.first?.trigger == .manual)
  }

  @Test func aPauseCountsTowardNoLap() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 30)
    session.togglePause()
    ride(&session, seconds: 300)
    session.togglePause()
    ride(&session, seconds: 30)
    #expect(laps(session).map(\.duration) == [60])
  }

  @Test func eachLapTotalsOnlyTheSecondsInsideIt() {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 60, power: 150)
    ride(&session, seconds: 120, power: 250)
    ride(&session, seconds: 60, power: 100)
    let laps = session.recording().laps
    #expect(laps.map(\.averagePower) == [150, 250, 100])
    #expect(laps.map(\.averageHeartRate) == [140, 140, 140])
    let distance = laps.compactMap(\.distanceMetres).reduce(0, +)
    #expect(abs(distance - session.distanceMetres) < 0.001)
  }

  @Test func lapsSurviveTheFITFile() throws {
    var session = RideSession(workout: workout.workout(ftp: 250))
    ride(&session, seconds: 100)
    session.markLap()
    ride(&session, seconds: 200)
    let recording = session.recording()
    let decoded = try FITDecoder.decode(FITEncoder.encode(recording))
    #expect(decoded.laps.count == 5)
    #expect(decoded.laps.map(\.start) == recording.laps.map(\.start))
    #expect(decoded.laps.map(\.duration) == recording.laps.map(\.duration))
    #expect(decoded.laps.map(\.stepIndex) == [0, 1, 1, 2, nil])
    #expect(decoded.laps.map(\.trigger) == [.time, .manual, .time, .time, .sessionEnd])
    #expect(decoded.laps.map(\.averagePower) == recording.laps.map(\.averagePower))
  }

  @Test func aRideFileFromBeforeLapsDecodesItsOneLapWithNoStep() throws {
    let file = URL(filePath: #filePath).deletingLastPathComponent()
      .appending(path: "Fixtures/ride-before-laps.fit")
    let recording = try FITDecoder.decode(Data(contentsOf: file))
    #expect(recording.laps.count == 1)
    #expect(recording.laps.first?.start == 0)
    #expect(recording.laps.first?.duration == recording.summary.duration)
    #expect(recording.laps.first?.stepIndex == nil)
    #expect(recording.laps.first?.averagePower == nil)
    #expect(recording.samples.count > 500)
  }

  @Test func readsTheLapsAnotherAppWrote() throws {
    let laps = try RideRecording.sample().laps
    #expect(laps.count == 10)
    #expect(laps.first?.trigger == .manual)
    #expect(laps.first?.duration == 180)
    #expect(laps.first?.averagePower == 114)
    #expect(laps.last?.trigger == .sessionEnd)
  }
}
