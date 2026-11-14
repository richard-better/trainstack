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

  @Test func averagesTheCurrentIntervalAndStartsAgainAtTheNext() {
    var session = RideSession(workout: workout)
    #expect(session.intervalAveragePower == nil)
    ride(&session, seconds: 30, power: 90)
    ride(&session, seconds: 30, power: 110)
    #expect(session.currentInterval?.index == 1)
    #expect(session.intervalAveragePower == nil)
    ride(&session, seconds: 10, power: 210)
    #expect(session.intervalAveragePower == 210)
    ride(&session, seconds: 10, power: 190)
    #expect(session.intervalAveragePower == 200)
    ride(&session, seconds: 100)
    #expect(session.isComplete)
    #expect(session.intervalAveragePower == nil)
  }

  @Test func aSampleEndingAtAnIntervalsStartBelongsToTheIntervalBefore() {
    var session = RideSession(workout: workout)
    ride(&session, seconds: 59, power: 100)
    ride(&session, seconds: 1, power: 500)
    #expect(session.samples.last?.position == session.currentInterval?.start)
    #expect(session.intervalAveragePower == nil)
    ride(&session, seconds: 1, power: 200)
    #expect(session.intervalAveragePower == 200)
  }

  @Test func skippingStartsTheIntervalAverageAfresh() {
    var session = RideSession(workout: workout)
    ride(&session, seconds: 20, power: 100)
    session.skipInterval()
    #expect(session.intervalAveragePower == nil)
    ride(&session, seconds: 5, power: 250)
    #expect(session.intervalAveragePower == 250)
  }

  @Test func leavesPausedTimeOutOfTheTotals() {
    var session = RideSession(workout: workout)
    ride(&session, seconds: 60, power: 100)
    session.togglePause()
    for _ in 0..<30 { session.advance(by: 1, reading: .init(power: 0, heartRate: 90)) }
    session.togglePause()
    ride(&session, seconds: 60, power: 300)
    let totals = RideTotals(session: session, ftp: 200)
    #expect(totals.averagePower == 200)
    #expect(totals.averageHeartRate == 140)
    #expect(totals.workKilojoules == 24)
    #expect(totals.intervalAveragePower == 300)
  }

  @Test func scoresTheRideSoFarAgainstFTP() throws {
    var session = RideSession(workout: workout)
    #expect(RideTotals(session: session, ftp: 200) == RideTotals())
    ride(&session, seconds: 20, power: 200)
    #expect(RideTotals(session: session, ftp: 200).normalizedPower == nil)
    ride(&session, seconds: 160, power: 200)
    let totals = RideTotals(session: session, ftp: 200)
    #expect(totals.normalizedPower == 200)
    #expect(totals.intensityFactor == 1)
    #expect(totals.stressScore == 5)
    #expect(totals.workKilojoules == 36)
    let easier = RideTotals(session: session, ftp: 250)
    #expect(try #require(easier.intensityFactor) == 0.8)
    #expect(easier.stressScore == 3)
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
    #expect(session.nextInterval?.averagePlannedPower == 200)
    #expect(session.nextInterval.map { $0.end - $0.start } == 120)
    ride(&session, seconds: 60)
    #expect(session.currentInterval?.index == 1)
    #expect(session.nextInterval == nil)
    ride(&session, seconds: 120)
    #expect(session.nextInterval == nil)
  }

  @Test func looksAheadThroughRepeats() throws {
    let tabata = try #require(WorkoutTemplate.named("Tabata 4×40/20")).workout(ftp: 200)
    var session = RideSession(workout: tabata)
    ride(&session, seconds: 1_490)
    #expect(session.currentInterval?.index == 5)
    #expect(session.nextInterval?.index == 6)
    #expect(session.nextInterval?.averagePlannedPower == 340)
    #expect(session.nextInterval.map { $0.end - $0.start } == 40)
    ride(&session, seconds: 170)
    #expect(session.currentInterval?.index == 11)
    #expect(session.nextInterval?.index == 12)
    #expect(session.nextInterval?.averagePlannedPower == 100)
    ride(&session, seconds: 20)
    #expect(session.currentInterval?.index == 12)
    #expect(session.nextInterval == nil)
  }

  @Test func countsDownTheWorkoutTimeLeft() {
    var session = RideSession(workout: workout)
    #expect(session.remaining == 180)
    ride(&session, seconds: 10)
    #expect(session.remaining == 170)
    session.togglePause()
    session.advance(by: 5, reading: .init())
    #expect(session.remaining == 170)
    session.togglePause()
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
    #expect(session.slopeGradePercent == 3.5)
    session.mode = .level
    session.adjust(by: 1)
    #expect(session.level == 7)
    session.adjust(by: 100)
    #expect(session.level == RideSession.levelRange.upperBound)
    #expect(session.ergPercent == 95)
    #expect(session.slopeGradePercent == 3.5)
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
    #expect(recording.summary.distanceMetres == session.distanceMetres)
    #expect(recording.samples.last?.distanceMetres == session.distanceMetres)
    #expect(recording.samples.last?.speedMetresPerSecond == session.speedMetresPerSecond)
  }

  @Test func ridesAsFastAsThePowerMovesTheRider() {
    var session = RideSession(workout: workout)
    #expect(session.speedMetresPerSecond == 0)
    ride(&session, seconds: 120, power: 115)
    #expect((26...29).contains(session.speedMetresPerSecond * 3.6))
    let distance = session.distanceMetres
    ride(&session, seconds: 60, power: 115)
    #expect(abs(session.distanceMetres - distance - session.speedMetresPerSecond * 60) < 5)
  }

  @Test func ridesSlowerUpTheSetGradeInSlopeModeOnly() {
    var flat = RideSession(workout: workout)
    var climbing = RideSession(workout: workout)
    climbing.mode = .slope
    #expect(climbing.slopeGradePercent == 2)
    ride(&flat, seconds: 120)
    ride(&climbing, seconds: 120)
    #expect(climbing.speedMetresPerSecond < flat.speedMetresPerSecond * 0.8)
    var level = RideSession(workout: workout)
    level.mode = .level
    ride(&level, seconds: 120)
    #expect(level.speedMetresPerSecond == flat.speedMetresPerSecond)
  }

  @Test func aHeavierRiderRidesSlowerUphill() {
    var light = RideSession(workout: workout, riderWeight: 60)
    var heavy = RideSession(workout: workout, riderWeight: 90)
    light.mode = .slope
    heavy.mode = .slope
    ride(&light, seconds: 120)
    ride(&heavy, seconds: 120)
    #expect(heavy.speedMetresPerSecond < light.speedMetresPerSecond)
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

  @Test func theSameSeedGivesTheSameSimulatedRide() {
    func readings(seed: UInt64) -> [TrainerReading] {
      var trainer = SimulatedTrainer(seed: seed)
      let session = RideSession(workout: workout)
      return (0..<30).map { _ in trainer.reading(for: session, after: 1) }
    }
    #expect(readings(seed: 3) == readings(seed: 3))
    #expect(readings(seed: 3) != readings(seed: 4))
  }
}
