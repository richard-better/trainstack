import Foundation
import Testing

@testable import RideData

struct HealthActivityFITTests {
  static let golden = URL(filePath: #filePath).deletingLastPathComponent().appending(
    path: "Fixtures/health-run.fit")

  static let start = Date(timeIntervalSince1970: 1_793_520_000)

  static func run() -> HealthActivity {
    let minutes = 30.0
    let seconds = Array(stride(from: 0.0, through: minutes * 60, by: 1))
    let pause = HealthActivity.Pause(
      from: start.addingTimeInterval(900), to: start.addingTimeInterval(1020))
    let moving = seconds.filter { !(900..<1020).contains($0) }
    let metresPerSecond = 3.2
    func metres(at second: Double) -> Double {
      metresPerSecond * (min(second, 900) + max(second - 1020, 0))
    }
    return HealthActivity(
      sport: .running, startDate: start, endDate: start.addingTimeInterval(minutes * 60),
      utcOffsetSeconds: 3600,
      heartRate: stride(from: 2.0, through: minutes * 60, by: 5).map {
        .init(date: start.addingTimeInterval($0), value: 140 + 10 * sin($0 / 120))
      },
      distanceSoFar: stride(from: 10.0, through: minutes * 60, by: 10).map {
        .init(date: start.addingTimeInterval($0), value: metres(at: $0))
      },
      locations: moving.map { second in
        .init(
          date: start.addingTimeInterval(second),
          latitude: 47.5 + metres(at: second) / 111_195, longitude: 19.04,
          altitudeMetres: 105 + second / 60, speedMetresPerSecond: metresPerSecond)
      },
      pauses: [pause], totalDistanceMetres: metres(at: minutes * 60), activeKilocalories: 412,
      ascentMetres: 30)
  }

  @Test func writesTheGoldenFileTheServerReads() throws {
    let file = FITEncoder.encode(Self.run())
    if ProcessInfo.processInfo.environment["RIDE_RECORD_HEALTH"] == "1" {
      try file.write(to: Self.golden)
    }
    #expect(
      file == (try Data(contentsOf: Self.golden)),
      "Ride no longer writes Fixtures/health-run.fit, which tests/health-activity-fit.test.mjs reads as the server does. Record with RIDE_RECORD_HEALTH=1."
    )
  }

  @Test func theSameWorkoutReadInAnyOrderIsTheSameFile() {
    let run = Self.run()
    var shuffled = run
    shuffled.heartRate.reverse()
    shuffled.distanceSoFar.shuffle()
    shuffled.locations.reverse()
    #expect(FITEncoder.encode(shuffled) == FITEncoder.encode(run))
  }

  @Test func aFileOfAHealthWorkoutIsNotOneRideRecorded() {
    #expect(!FITDecoder.isRecordedByRide(FITEncoder.encode(Self.run())))
  }

  @Test func readsBackWithItsSportTimesAndDistance() throws {
    let run = Self.run()
    let decoded = try FITDecoder.decode(FITEncoder.encode(run))
    #expect(decoded.sport == .running)
    #expect(decoded.startDate == run.startDate)
    #expect(decoded.summary.distanceMetres == run.totalDistanceMetres)
    #expect(decoded.samples.filter { $0.elapsed >= 2 }.allSatisfy { $0.heartRate != nil })
  }

  @Test func holdsAReadingNoLongerThanTheSamplingRuleDoes() throws {
    let start = Self.start
    let activity = HealthActivity(
      sport: .strength, startDate: start, endDate: start.addingTimeInterval(120),
      heartRate: [.init(date: start, value: 100)],
      power: [.init(date: start.addingTimeInterval(60), value: 200)])
    let decoded = try FITDecoder.decode(FITEncoder.encode(activity))
    #expect(decoded.samples.map(\.heartRate) == [100, nil])
    #expect(decoded.samples.map(\.power) == [nil, 200])
  }

  @Test func aWorkoutWithoutMeasuredSpeedGetsItsSpeedFromItsDistance() throws {
    let start = Self.start
    let activity = HealthActivity(
      sport: .running, startDate: start, endDate: start.addingTimeInterval(60),
      distanceSoFar: stride(from: 0.0, through: 60, by: 10).map {
        .init(date: start.addingTimeInterval($0), value: 3 * $0)
      },
      locations: stride(from: 0.0, through: 60, by: 1).map {
        .init(date: start.addingTimeInterval($0), latitude: 47.5, longitude: 19.04)
      })
    let decoded = try FITDecoder.decode(FITEncoder.encode(activity))
    #expect(decoded.samples.dropLast().allSatisfy { $0.speedMetresPerSecond == 3 })
  }

  @Test func everyHealthSportHasAFITSport() {
    #expect(
      HealthSport.strength.fit == (FITProfile.Sport.training, FITProfile.SubSport.strengthTraining))
    #expect(HealthSport.other.fit.sport == FITProfile.Sport.generic)
  }
}
