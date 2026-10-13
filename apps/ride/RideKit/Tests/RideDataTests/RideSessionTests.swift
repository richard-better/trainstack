import Foundation
import Testing

@testable import RideData

struct RideSessionTests {
  private let workout = Workout(
    name: "Two steps",
    steps: [.init(duration: 60, targetPower: 100), .init(duration: 120, targetPower: 200)])

  private func ride(_ session: inout RideSession, seconds: Int, power: Int = 150) {
    for _ in 0..<seconds {
      session.advance(by: 1, reading: .init(power: power, heartRate: 140))
    }
  }

  @Test func followsTheWorkoutIntervalByInterval() {
    var session = RideSession(workout: workout)
    #expect(session.targetPower == 100)
    ride(&session, seconds: 59)
    #expect(session.intervalRemaining == 1)
    ride(&session, seconds: 1)
    #expect(session.currentInterval?.index == 1)
    #expect(session.targetPower == 200)
    ride(&session, seconds: 120)
    #expect(session.isComplete)
    #expect(session.targetPower == nil)
  }

  @Test func recordsNothingWhilePaused() {
    var session = RideSession(workout: workout)
    ride(&session, seconds: 10)
    session.togglePause()
    session.advance(by: 1, reading: .init(power: 0))
    #expect(session.elapsed == 10)
    #expect(session.samples.count == 10)
    #expect(session.latest.power == 0)
    session.togglePause()
    ride(&session, seconds: 1)
    #expect(session.elapsed == 11)
  }

  @Test func skippingMovesTheWorkoutButNotTheRideClock() {
    var session = RideSession(workout: workout)
    ride(&session, seconds: 10)
    session.skipInterval()
    #expect(session.position == 60)
    #expect(session.elapsed == 10)
    #expect(session.targetPower == 200)
    session.skipInterval()
    #expect(session.isComplete)
  }

  @Test func looksAheadToTheNextInterval() {
    var session = RideSession(workout: workout)
    #expect(session.nextInterval?.index == 1)
    #expect(session.nextInterval?.plannedPower == 200)
    #expect(session.nextInterval.map { $0.end - $0.start } == 120)
    ride(&session, seconds: 60)
    // On the last interval nothing follows.
    #expect(session.currentInterval?.index == 1)
    #expect(session.nextInterval == nil)
    ride(&session, seconds: 120)
    #expect(session.nextInterval == nil)
  }

  @Test func looksAheadThroughRepeats() throws {
    // Four 40-second sprints at 340 W with 20 seconds at 80 W between, after 24 minutes of
    // warm-up and before 5 minutes at 100 W.
    let tabata = try #require(WorkoutTemplate.named("Tabata 4×40/20")).workout(ftp: 200)
    var session = RideSession(workout: tabata)
    ride(&session, seconds: 1_490)
    #expect(session.currentInterval?.index == 5)
    #expect(session.nextInterval?.index == 6)
    #expect(session.nextInterval?.plannedPower == 340)
    #expect(session.nextInterval.map { $0.end - $0.start } == 40)
    ride(&session, seconds: 170)
    // The last rest leads into the cool-down, which is the last interval.
    #expect(session.currentInterval?.index == 11)
    #expect(session.nextInterval?.index == 12)
    #expect(session.nextInterval?.plannedPower == 100)
    ride(&session, seconds: 20)
    #expect(session.currentInterval?.index == 12)
    #expect(session.nextInterval == nil)
  }

  @Test func countsDownTheWorkoutTimeLeft() {
    var session = RideSession(workout: workout)
    #expect(session.remaining == 180)
    ride(&session, seconds: 10)
    #expect(session.remaining == 170)
    // Pausing stops the countdown with the ride clock.
    session.togglePause()
    session.advance(by: 5, reading: .init())
    #expect(session.remaining == 170)
    session.togglePause()
    // Skipping takes the rest of the interval off.
    session.skipInterval()
    #expect(session.remaining == 120)
    #expect(session.elapsed == 10)
    session.skipInterval()
    #expect(session.remaining == 0)
  }

  @Test func adjustsTheSettingOfTheCurrentMode() {
    var session = RideSession(workout: workout)
    session.adjust(by: -5)
    #expect(session.targetPower == 95)
    session.mode = .slope
    #expect(session.targetPower == nil)
    session.adjust(by: 3)
    #expect(session.grade == 3.5)
    session.mode = .level
    session.adjust(by: 100)
    #expect(session.level == RideSession.levelRange.upperBound)
    // The other modes keep their settings.
    #expect(session.ergPercent == 95)
  }

  @Test func recordsTheTargetOnlyInERG() {
    var session = RideSession(workout: workout)
    ride(&session, seconds: 2)
    session.mode = .slope
    ride(&session, seconds: 2)
    #expect(session.recording().samples.map(\.targetPower) == [100, 100, nil, nil])
  }

  @Test func summarisesTheRecording() {
    var session = RideSession(workout: workout)
    ride(&session, seconds: 30, power: 100)
    ride(&session, seconds: 30, power: 200)
    let recording = session.recording()
    #expect(recording.workoutName == "Two steps")
    #expect(recording.summary.duration == 60)
    #expect(recording.summary.averagePower == 150)
    #expect(recording.summary.maxPower == 200)
    #expect(recording.summary.distance == session.distance)
    #expect(recording.samples.last?.distance == session.distance)
    #expect(recording.samples.last?.speed == session.speed)
  }

  @Test func ridesAsFastAsThePowerMovesTheRider() {
    var session = RideSession(workout: workout)
    #expect(session.speed == 0)
    ride(&session, seconds: 120, power: 115)
    #expect((26...29).contains(session.speed * 3.6))
    let distance = session.distance
    ride(&session, seconds: 60, power: 115)
    #expect(abs(session.distance - distance - session.speed * 60) < 5)
  }

  @Test func ridesSlowerUpTheSetGradeInSlopeModeOnly() {
    var flat = RideSession(workout: workout)
    var climbing = RideSession(workout: workout)
    climbing.mode = .slope
    #expect(climbing.grade == 2)
    ride(&flat, seconds: 120)
    ride(&climbing, seconds: 120)
    #expect(climbing.speed < flat.speed * 0.8)
    var level = RideSession(workout: workout)
    level.mode = .level
    ride(&level, seconds: 120)
    #expect(level.speed == flat.speed)
  }

  @Test func aHeavierRiderRidesSlowerUphill() {
    var light = RideSession(workout: workout, riderWeight: 60)
    var heavy = RideSession(workout: workout, riderWeight: 90)
    light.mode = .slope
    heavy.mode = .slope
    ride(&light, seconds: 120)
    ride(&heavy, seconds: 120)
    #expect(heavy.speed < light.speed)
  }

  @Test func showsPowerSmoothedButRecordsEveryReading() {
    var session = RideSession(workout: workout)
    for power in [210, 0, 240] { session.advance(by: 1, reading: .init(power: power)) }
    #expect(session.power(.instant) == 240)
    #expect(session.power(.threeSeconds) == 150)
    #expect(session.samples.map(\.sample.power) == [210, 0, 240])
    session.pause()
    session.advance(by: 1, reading: .init(power: 0))
    #expect(session.power(.threeSeconds) == 80)
  }

  @Test func simulatedTrainerHoldsTheERGTarget() {
    var session = RideSession(workout: workout)
    var trainer = SimulatedTrainer()
    var powers: [Int] = []
    for _ in 0..<60 {
      let reading = trainer.reading(for: session, after: 1)
      session.advance(by: 1, reading: reading)
      powers.append(reading.power ?? 0)
    }
    let average = Double(powers.reduce(0, +)) / Double(powers.count)
    #expect(abs(average - 100) < 10)
  }
}
