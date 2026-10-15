import Foundation
import HealthKit
import RideData

/// A ride as Health keeps it: an indoor cycling workout with the power, cadence and heart rate
/// of each second, and the energy the rider burned to turn the pedals.
nonisolated struct HealthWorkout {
  let startDate: Date
  let endDate: Date
  let samples: [HKQuantitySample]
  /// Names the workout by the ride's ID, so Health keeps one workout for a ride however many
  /// devices save it.
  let metadata: [String: Any]

  init(_ ride: Ride) {
    let recording = ride.recording
    let start = recording.startDate
    startDate = start
    endDate = start.addingTimeInterval(
      max(recording.summary.duration, recording.samples.last?.elapsed ?? 0))
    metadata = [
      HKMetadataKeyIndoorWorkout: true,
      HKMetadataKeySyncIdentifier: ride.id,
      HKMetadataKeySyncVersion: 1,
    ]

    let perMinute = HKUnit.count().unitDivided(by: .minute())
    var samples: [HKQuantitySample] = []
    var energy = EnergyTally(start: start)
    var previous: TimeInterval?
    for sample in recording.samples {
      // A sample covers the time since the one before it.
      let from = start.addingTimeInterval(previous ?? max(sample.elapsed - 1, 0))
      let to = start.addingTimeInterval(sample.elapsed)
      previous = sample.elapsed
      guard to > from else { continue }
      func add(_ identifier: HKQuantityTypeIdentifier, _ unit: HKUnit, _ value: Int?) {
        guard let value else { return }
        samples.append(
          HKQuantitySample(
            type: HKQuantityType(identifier),
            quantity: HKQuantity(unit: unit, doubleValue: Double(value)), start: from, end: to))
      }
      add(.cyclingPower, .watt(), sample.power)
      add(.cyclingCadence, perMinute, sample.cadence)
      add(.heartRate, perMinute, sample.heartRate)
      if let power = sample.power {
        samples += energy.add(joules: Double(power) * to.timeIntervalSince(from), until: to)
      }
    }
    samples += energy.finish()
    self.samples = samples
  }

  /// Active energy in a sample a minute, from the work done at the pedals.
  private struct EnergyTally {
    /// The share of the energy a rider burns that reaches the pedals.
    private static let grossEfficiency = 0.24
    private static let span: TimeInterval = 60

    private var start: Date
    private var end: Date
    private var joules = 0.0

    init(start: Date) {
      self.start = start
      end = start
    }

    mutating func add(joules: Double, until date: Date) -> [HKQuantitySample] {
      self.joules += joules
      end = date
      return date.timeIntervalSince(start) >= Self.span ? finish() : []
    }

    mutating func finish() -> [HKQuantitySample] {
      defer {
        start = end
        joules = 0
      }
      guard joules > 0, end > start else { return [] }
      let burned = HKQuantity(unit: .joule(), doubleValue: joules / Self.grossEfficiency)
      return [
        HKQuantitySample(
          type: HKQuantityType(.activeEnergyBurned), quantity: burned, start: start, end: end)
      ]
    }
  }
}
