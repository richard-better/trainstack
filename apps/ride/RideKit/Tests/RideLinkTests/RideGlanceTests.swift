import Foundation
import RideData
import Testing

@testable import RideLink

struct RideGlanceTests {
  /// Warm up, three threshold efforts with recoveries, then an endurance spin, for a 200 W FTP.
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
}
