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
    var energy = EnergyTally(rideID: ride.id, start: start)
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
          Self.sample(
            identifier, HKQuantity(unit: unit, doubleValue: Double(value)), from: from, to: to,
            of: ride.id))
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

  /// A sample named by its ride, type and start, so Health keeps one of it however many devices
  /// save the ride, and however many times one tries.
  private static func sample(
    _ identifier: HKQuantityTypeIdentifier, _ quantity: HKQuantity, from: Date, to: Date,
    of rideID: Ride.ID
  ) -> HKQuantitySample {
    let milliseconds = Int((from.timeIntervalSince1970 * 1000).rounded())
    return HKQuantitySample(
      type: HKQuantityType(identifier), quantity: quantity, start: from, end: to,
      metadata: [
        HKMetadataKeySyncIdentifier: "\(rideID).\(identifier.rawValue).\(milliseconds)",
        HKMetadataKeySyncVersion: 1,
      ])
  }

  /// Active energy in a sample a minute, from the work done at the pedals.
  private struct EnergyTally {
    /// The share of the energy a rider burns that reaches the pedals.
    private static let grossEfficiency = 0.24
    private static let span: TimeInterval = 60

    private let rideID: Ride.ID
    private var start: Date
    private var end: Date
    private var joules = 0.0

    init(rideID: Ride.ID, start: Date) {
      self.rideID = rideID
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
      return [HealthWorkout.sample(.activeEnergyBurned, burned, from: start, to: end, of: rideID)]
    }
  }
}
