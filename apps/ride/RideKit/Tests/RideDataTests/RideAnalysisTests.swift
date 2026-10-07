import Foundation
import Testing

@testable import RideData

struct RideAnalysisTests {
  @Test func classifiesHeartRateByFractionOfMax() {
    #expect(HeartRateZone.zone(heartRate: 90, maxHeartRate: 200) == .recovery)
    #expect(HeartRateZone.zone(heartRate: 120, maxHeartRate: 200) == .aerobic)
    #expect(HeartRateZone.zone(heartRate: 139, maxHeartRate: 200) == .aerobic)
    #expect(HeartRateZone.zone(heartRate: 140, maxHeartRate: 200) == .tempo)
    #expect(HeartRateZone.zone(heartRate: 170, maxHeartRate: 200) == .threshold)
    #expect(HeartRateZone.zone(heartRate: 195, maxHeartRate: 200) == .vo2Max)
  }

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
    let zones = ride.heartRateZones(maxHeartRate: 200)
    #expect(zones.map(\.zone) == HeartRateZone.allCases)
    #expect(zones[HeartRateZone.recovery.rawValue].seconds == 2)
    #expect(zones[HeartRateZone.vo2Max.rawValue].seconds == 1)
    #expect(zones[HeartRateZone.recovery.rawValue].fraction == 2.0 / 3.0)
    #expect(zones.map(\.fraction).reduce(0, +) == 1)
  }

  @Test func hasNoZonesWithoutHeartRate() {
    #expect(
      recording([.init(elapsed: 0, power: 100), .init(elapsed: 1, power: 100)])
        .heartRateZones(maxHeartRate: 190).isEmpty)
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

  @Test func classifiesPowerByFractionOfFTP() {
    #expect(PowerZone.zone(power: 100, ftp: 200) == .recovery)
    #expect(PowerZone.zone(power: 110, ftp: 200) == .endurance)
    #expect(PowerZone.zone(power: 149, ftp: 200) == .endurance)
    #expect(PowerZone.zone(power: 150, ftp: 200) == .tempo)
    #expect(PowerZone.zone(power: 190, ftp: 200) == .threshold)
    #expect(PowerZone.zone(power: 220, ftp: 200) == .vo2Max)
    #expect(PowerZone.zone(power: 250, ftp: 200) == .anaerobic)
  }

  @Test func sharesTimeAcrossPowerZones() throws {
    let zones = try RideRecording.sample().powerZones(ftp: 200)
    #expect(zones.map(\.zone) == PowerZone.allCases)
    #expect(abs(zones.map(\.fraction).reduce(0, +) - 1) < 1e-9)
    // The sample ride is an easy ride: nothing above tempo at an FTP of 200.
    #expect(zones[PowerZone.threshold.rawValue].seconds == 0)
    #expect(zones[PowerZone.endurance.rawValue].fraction > zones[PowerZone.tempo.rawValue].fraction)
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
