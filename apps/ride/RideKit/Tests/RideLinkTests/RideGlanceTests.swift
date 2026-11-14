import Foundation
import RideData
import Testing

@testable import RideLink

struct RideGlanceTests {
  private let workout = Workout(
    name: "Threshold 3×10",
    steps: [
      .init(duration: 300, targetPower: 100),
      .init(duration: 600, targetPower: 190), .init(duration: 120, targetPower: 100),
      .init(duration: 600, targetPower: 190), .init(duration: 120, targetPower: 100),
      .init(duration: 600, targetPower: 190), .init(duration: 300, targetPower: 120),
    ])
  private let heartRateZones = ZoneModel.standard(for: .heartRate, in: nil).flatMap {
    ZoneSet(model: $0, limits: $0.limits(from: [.maxHeartRate: 190]) ?? [])
  }

  private func session(at position: Int, heartRate: Int? = 150) -> RideSession {
    var session = RideSession(workout: workout)
    for _ in 0..<position {
      session.advance(
        by: 1, reading: .init(power: 188, heartRate: heartRate, heartRateSource: .watch))
    }
    return session
  }

  @Test func describesTheIntervalAndTheOneAfter() throws {
    let glance = RideGlance(
      session: session(at: 1_200), ftp: 200, heartRateZones: heartRateZones)
    let interval = try #require(glance.interval)
    #expect(interval.index == 3)
    #expect(interval.title == "Threshold 2/3")
    #expect(interval.targetPower == 190)
    #expect(interval.remaining == 420)
    #expect(abs(interval.progress - 0.3) < 0.001)
    #expect(glance.next == .init(zone: .recovery, targetPower: 100))
    #expect(glance.power == 188)
    #expect(glance.heartRate == 150)
    #expect(glance.heartRateSource == .watch)
    #expect(glance.heartRateZone != nil)
  }

  @Test func appliesTheRidersErgAdjustment() {
    var ride = session(at: 10)
    ride.adjust(by: 5)
    let glance = RideGlance(session: ride, ftp: 200, heartRateZones: nil)
    #expect(glance.interval?.targetPower == 105)
    #expect(glance.next?.targetPower == 200)
  }

  @Test func showsPowerAsTheRiderChose() {
    var ride = session(at: 10)
    ride.advance(by: 1, reading: .init(power: 0))
    ride.advance(by: 1, reading: .init(power: 0))
    #expect(RideGlance(session: ride, ftp: 200, heartRateZones: nil).power == 63)
    #expect(
      RideGlance(session: ride, ftp: 200, heartRateZones: nil, powerDisplay: .instant).power == 0)
  }

  @Test func hasNoTargetsOutsideErg() {
    var ride = session(at: 10)
    ride.mode = .slope
    let glance = RideGlance(session: ride, ftp: 200, heartRateZones: nil)
    #expect(glance.interval?.targetPower == nil)
    #expect(glance.next?.targetPower == nil)
  }

  @Test func namesAnIntervalAloneInItsZoneWithoutANumber() {
    let glance = RideGlance(session: session(at: 2_500), ftp: 200, heartRateZones: nil)
    #expect(glance.interval?.title == "Endurance")
    #expect(glance.next == nil)
  }

  @Test func hasNoIntervalOnceTheWorkoutIsDone() {
    let glance = RideGlance(session: session(at: 3_000), ftp: 200, heartRateZones: nil)
    #expect(glance.interval == nil)
  }

  @Test func hasNoHeartRateZoneWithoutHeartRate() {
    let glance = RideGlance(
      session: session(at: 10, heartRate: nil), ftp: 200, heartRateZones: heartRateZones)
    #expect(glance.heartRateZone == nil)
  }

  @Test func survivesTheTripBetweenDevices() throws {
    let glance = RideGlance(
      session: session(at: 1_200), ftp: 200, heartRateZones: heartRateZones)
    for message in [LinkMessage.glance(glance), .rideEnded, .rideRecorded, .heartRate(152)] {
      #expect(try LinkMessage(data: message.encoded()) == message)
    }
  }

  @Test func callsAStepWithoutAPowerTargetAFreeRideAndFollowsARamp() {
    let planned = PlannedWorkout(
      name: "Free and ramp", category: nil,
      steps: [
        PlannedStep(duration: 60, target: nil),
        PlannedStep(duration: 100, target: .watts(.ramp(from: 100, to: 200))),
      ])
    var session = RideSession(workout: planned.workout(ftp: 200))
    var glance = RideGlance(session: session, ftp: 200, heartRateZones: nil)
    #expect(glance.interval?.zone == nil)
    #expect(glance.interval?.title == RideGlance.freeRideTitle)
    #expect(glance.interval?.targetPower == nil)
    #expect(glance.next == .init(zone: .tempo, targetPower: 100))
    for _ in 0..<110 { session.advance(by: 1, reading: .init(power: 150)) }
    glance = RideGlance(session: session, ftp: 200, heartRateZones: nil)
    #expect(glance.interval?.targetPower == 150)
    #expect(glance.interval?.zone == .tempo)
  }

  @Test func namesAHeartRateStepAndItsTargetRatherThanAFreeRide() {
    let planned = PlannedWorkout(
      name: "Heart rate", category: nil,
      steps: [
        PlannedStep(duration: 60, target: .beatsPerMinute(.constant(140))),
        PlannedStep(duration: 60, target: .shareOfThresholdHeartRate(.range(low: 0.8, high: 0.85))),
        PlannedStep(duration: 20, target: .maxEffort),
      ])
    var session = RideSession(workout: planned.workout(ftp: 200))
    let glance = RideGlance(session: session, ftp: 200, heartRateZones: nil)
    #expect(glance.interval?.title == "Heart rate 140 bpm")
    #expect(glance.next?.title == "Heart rate 80–85% threshold")
    for _ in 0..<60 { session.advance(by: 1, reading: .init(power: 150)) }
    #expect(
      RideGlance(session: session, ftp: 200, heartRateZones: nil).next?.title == "Max effort")
  }

  @Test func countsALapButtonStepUpAndNeverDownOnTheWatch() {
    let planned = PlannedWorkout(
      name: "Lap", category: nil,
      steps: [
        PlannedStep(duration: 0, target: .watts(.constant(200)), untilLap: UntilLap()),
        PlannedStep(duration: 60, target: .watts(.constant(100))),
      ])
    var session = RideSession(workout: planned.workout(ftp: 200))
    var countdown = IntervalCountdown()
    for _ in 0..<45 {
      session.advance(by: 1, reading: .init(power: 200))
      let glance = RideGlance(session: session, ftp: 200, heartRateZones: nil)
      #expect(countdown.update(glance.interval, isPaused: false) == nil)
    }
    let glance = RideGlance(session: session, ftp: 200, heartRateZones: nil)
    #expect(glance.interval?.elapsedUntilLap == 45)
    #expect(glance.interval?.remaining == 0)
    #expect(glance.interval?.progress == 0)
    #expect(glance.interval?.targetPower == 200)
  }

  @Test func carriesTheIntervalTextWhileItShowsIfTheWatchHasRoomForIt() {
    var session = RideSession(
      workout: Workout(
        name: "Text",
        steps: [
          .init(
            duration: 60, target: .power(.constant(150)), name: "Openers",
            cues: [
              PlannedCue(at: 0, text: "Settle in"),
              PlannedCue(at: 30, text: String(repeating: "Far too long for a wrist ", count: 3)),
            ])
        ]))
    session.advance(by: 1, reading: .init(power: 150))
    let glance = RideGlance(session: session, ftp: 200, heartRateZones: nil)
    #expect(glance.cue == "Settle in")
    #expect(glance.interval?.label == "Openers")
    for _ in 0..<12 { session.advance(by: 1, reading: .init(power: 150)) }
    #expect(RideGlance(session: session, ftp: 200, heartRateZones: nil).cue == nil)
    for _ in 0..<20 { session.advance(by: 1, reading: .init(power: 150)) }
    #expect(session.cue != nil)
    #expect(RideGlance(session: session, ftp: 200, heartRateZones: nil).cue == nil)
  }

  @Test func aPhoneWithoutIntervalTextStillSendsAGlanceTheWatchReads() throws {
    let older = try JSONEncoder().encode(RideGlance(workoutName: "Old", power: 100))
    let json = try #require(String(data: older, encoding: .utf8))
    #expect(!json.contains("cue"))
    #expect(try JSONDecoder().decode(RideGlance.self, from: older).cue == nil)
  }

  @Test func aNamedHeartRateStepKeepsItsTargetBesideItsName() {
    var session = RideSession(
      workout: Workout(
        name: "Named",
        steps: [
          .init(
            duration: 60, target: .heartRate(.beatsPerMinute(.constant(140))), name: "Openers"),
          .init(duration: 60, target: .power(.constant(200)), name: "Push"),
        ]))
    session.advance(by: 1, reading: .init(power: 150))
    let glance = RideGlance(session: session, ftp: 200, heartRateZones: nil)
    #expect(glance.interval?.label == "Openers · Heart rate 140 bpm")
    #expect(glance.next?.label == "Push")
  }
}
