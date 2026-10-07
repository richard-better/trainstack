import Foundation
import Testing

@testable import RideData

struct RideAnalysisTests {
  /// Zones at 60, 70, 80 and 90% of a max heart rate of 200.
  private let heartRateZones = RiderProfile(maxHeartRate: 200).zones(for: .heartRate)!

  @Test func sharesTimeAcrossZonesAndIgnoresPauses() {
    let ride = recording(
      [
        .init(elapsed: 0, heartRate: 100),
        .init(elapsed: 1, heartRate: 100),
        .init(elapsed: 2, heartRate: 190),
        .init(elapsed: 3, heartRate: 190),
        // Paused for a minute: the gap before this sample does not count.
        .init(elapsed: 63, heartRate: 190),
      ])
    let zones = ride.timeInZones(heartRateZones, of: .heartRate)
    #expect(zones.map(\.zone) == heartRateZones.zones)
    #expect(zones[0].seconds == 2)
    #expect(zones[4].seconds == 1)
    #expect(zones[0].fraction == 2.0 / 3.0)
    #expect(zones.map(\.fraction).reduce(0, +) == 1)
  }

  @Test func hasNoZonesWithoutHeartRate() {
    #expect(
      recording([.init(elapsed: 0, power: 100), .init(elapsed: 1, power: 100)])
        .timeInZones(heartRateZones, of: .heartRate).isEmpty)
  }

  @Test func findsTheBestAveragePowerPerDuration() {
    let powers = [100, 100, 300, 300, 100, 100]
    let ride = recording(powers.enumerated().map { .init(elapsed: Double($0), power: $1) })
    let curve = ride.powerCurve(durations: [1, 2, 4, 10])
    #expect(
      curve == [
        .init(duration: 1, power: 300),
        .init(duration: 2, power: 300),
        .init(duration: 4, power: 200),
      ])
  }

  @Test func sampleRideCurveNeverRises() throws {
    let curve = try RideRecording.sample().powerCurve()
    #expect(curve.count == 8)
    #expect(curve.last?.duration == 1800)
    #expect(curve.map(\.power) == curve.map(\.power).sorted(by: >))
  }

  @Test func sharesTimeAcrossPowerZones() throws {
    let powerZones = try #require(RiderProfile(ftp: 200).zones(for: .power))
    let zones = try RideRecording.sample().timeInZones(powerZones, of: .power)
    #expect(zones.map(\.zone) == powerZones.zones)
    #expect(abs(zones.map(\.fraction).reduce(0, +) - 1) < 1e-9)
    // The sample ride is an easy ride: nothing above tempo at an FTP of 200.
    #expect(zones[3].seconds == 0)
    #expect(zones[1].fraction > zones[2].fraction)
  }

  @Test func scoresTrainingStressFromNormalizedPower() throws {
    let ride = try RideRecording.sample()
    #expect(ride.normalizedPower() == 139)
    // About half an hour at 70% of FTP is a score of 24.
    #expect(ride.trainingStressScore(ftp: 200) == 24)
    #expect(try #require(ride.trainingStressScore(ftp: 150)) > 24)
  }

  @Test func hasNoStressForAVeryShortRide() {
    let samples = (0..<10).map { RideRecording.Sample(elapsed: Double($0), power: 200) }
    let ride = RideRecording(startDate: .now, samples: samples, summary: .init(duration: 9))
    #expect(ride.normalizedPower() == nil)
    #expect(ride.trainingStressScore(ftp: 200) == nil)
  }

  private func recording(_ samples: [RideRecording.Sample]) -> RideRecording {
    RideRecording(
      startDate: .now, samples: samples,
      summary: .init(duration: samples.last?.elapsed ?? 0))
  }
}
