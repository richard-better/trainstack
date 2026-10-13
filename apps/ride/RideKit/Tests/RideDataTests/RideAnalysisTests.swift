import Foundation
import Testing

@testable import RideData

struct RideAnalysisTests {
  /// Zones at 60, 70, 80 and 90% of a max heart rate of 200.
  private let heartRateZones = MetricZones(
    thresholds: [.maxHeartRate: 200], choice: ZoneChoice(model: .percentOfMax)
  ).zones!

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
    let powerZones = try #require(
      MetricZones(thresholds: [.ftp: 200], choice: ZoneChoice(model: .coggan6)).zones)
    let zones = try RideRecording.sample().timeInZones(powerZones, of: .power)
    #expect(zones.map(\.zone) == powerZones.zones)
    #expect(abs(zones.map(\.fraction).reduce(0, +) - 1) < 1e-9)
    // The sample ride is an easy ride: nothing above tempo at an FTP of 200.
    #expect(zones[3].seconds == 0)
    #expect(zones[1].fraction > zones[2].fraction)
  }

  @Test func sharesTimeAcrossPaceZonesWhileMoving() throws {
    let paceZones = try #require(
      MetricZones(thresholds: [.thresholdPace: 300], choice: ZoneChoice(model: .frielRunningPace))
        .zones)
    var run = recording([
      // 5:00 per kilometre, then stopped, then 6:40 per kilometre.
      .init(elapsed: 0, speed: 1000.0 / 300),
      .init(elapsed: 1, speed: 0),
      .init(elapsed: 2, speed: 2.5),
      .init(elapsed: 3, speed: 2.5),
    ])
    #expect(run.timeInZones(paceZones, of: .pace).isEmpty)
    run.sport = .running
    let shares = run.timeInZones(paceZones, of: .pace)
    #expect(shares.map(\.seconds) == [1, 0, 0, 0, 1, 0, 0])
  }

  @Test func scoresTrainingStressFromNormalizedPower() throws {
    let ride = try RideRecording.sample()
    #expect(ride.normalizedPower() == 139)
    // About half an hour at 70% of FTP is a score of 24.
    #expect(ride.trainingStressScore(ftp: 200) == 24)
    #expect(try #require(ride.trainingStressScore(ftp: 150)) > 24)
  }

  @Test func anHourAtFTPIsAnIntensityOfOneAndAScoreOfAHundred() {
    let ride = recording((0..<3600).map { .init(elapsed: Double($0), power: 250) })
    #expect(ride.normalizedPower() == 250)
    #expect(ride.intensityFactor(ftp: 250) == 1)
    #expect(ride.trainingStressScore(ftp: 250) == 100)
    #expect(ride.intensityFactor(ftp: 0) == nil)
  }

  @Test func addsUpWorkSecondBySecond() {
    // A minute at 100 W, then a minute at 300 W: 6 kJ and 18 kJ.
    let ride = recording((0..<120).map { .init(elapsed: Double($0), power: $0 < 60 ? 100 : 300) })
    #expect(ride.work() == 24)
    #expect(recording([.init(elapsed: 0, heartRate: 120)]).work() == nil)
  }

  @Test(arguments: [1.0, 1.2, 2.0])
  func addsUpTheSameWorkWhateverTheTimeBetweenSamples(interval: TimeInterval) {
    // Two minutes at 200 W is 24 kJ, however often the trainer reported.
    let count = Int((120 / interval).rounded()) + 1
    let ride = recording((0..<count).map { .init(elapsed: Double($0) * interval, power: 200) })
    #expect(ride.work() == 24)
  }

  @Test(arguments: [1.0, 1.2, 2.0])
  func findsTheSamePowerWhateverTheTimeBetweenSamples(interval: TimeInterval) {
    // Two minutes at 200 W, however often the trainer reported.
    let count = Int((120 / interval).rounded()) + 1
    let ride = recording((0..<count).map { .init(elapsed: Double($0) * interval, power: 200) })
    #expect(ride.normalizedPower() == 200)
    #expect(ride.powerCurve(durations: [5, 60]).map(\.power) == [200, 200])
  }

  @Test func leavesPausesOutOfThePowerPerSecond() {
    // Paused for a minute between two readings: the seconds between count as zero.
    let ride = recording([.init(elapsed: 0, power: 300), .init(elapsed: 60, power: 300)])
    #expect(ride.powerPerSecond().filter { $0 > 0 }.count == 2)
  }

  @Test func leavesPausesOutOfTheWork() {
    // A minute at 300 W, paused for a minute, then the samples carry on.
    var samples = (0...60).map { RideRecording.Sample(elapsed: Double($0), power: 300) }
    samples.append(.init(elapsed: 120, power: 300))
    #expect(recording(samples).work() == 18)
  }

  @Test func hasNoStressForAVeryShortRide() {
    let samples = (0..<10).map { RideRecording.Sample(elapsed: Double($0), power: 200) }
    let ride = RideRecording(startDate: .now, samples: samples, summary: .init(duration: 9))
    #expect(ride.normalizedPower() == nil)
    #expect(ride.trainingStressScore(ftp: 200) == nil)
    #expect(ride.intensityFactor(ftp: 200) == nil)
  }

  private func recording(_ samples: [RideRecording.Sample]) -> RideRecording {
    RideRecording(
      startDate: .now, samples: samples,
      summary: .init(duration: samples.last?.elapsed ?? 0))
  }
}
