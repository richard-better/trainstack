import Foundation
import HealthKit
import RideData
import Testing

@testable import RideUI

struct HealthWorkoutTests {
  private let start = Date(timeIntervalSince1970: 1_791_296_475)

  private func ride(seconds: Int = 90, power: Int? = 200) -> Ride {
    let samples = (1...seconds).map { second in
      RideRecording.Sample(
        elapsed: TimeInterval(second), power: power, heartRate: 140, cadence: 90)
    }
    let recording = RideRecording(
      startDate: start, workoutName: "Endurance", sport: .cycling, samples: samples,
      summary: .init(duration: TimeInterval(seconds)))
    return Ride(recording: recording, fileData: FITEncoder.encode(recording))
  }

  private func samples(
    _ identifier: HKQuantityTypeIdentifier, in workout: HealthWorkout
  ) -> [HKQuantitySample] {
    workout.samples.filter { $0.quantityType == HKQuantityType(identifier) }
  }

  @Test func coversTheRide() {
    let workout = HealthWorkout(ride())
    #expect(workout.startDate == start)
    #expect(workout.endDate == start.addingTimeInterval(90))
  }

  @Test func recordsEachSecond() throws {
    let workout = HealthWorkout(ride())
    let power = samples(.cyclingPower, in: workout)
    #expect(power.count == 90)
    #expect(power.first?.startDate == start)
    #expect(power.first?.endDate == start.addingTimeInterval(1))
    #expect(power.allSatisfy { $0.quantity.doubleValue(for: .watt()) == 200 })
    let perMinute = HKUnit.count().unitDivided(by: .minute())
    let cadence = samples(.cyclingCadence, in: workout)
    #expect(cadence.count == 90)
    #expect(cadence.allSatisfy { $0.quantity.doubleValue(for: perMinute) == 90 })
    #expect(samples(.heartRate, in: workout).count == 90)
  }

  @Test func burnsEnergyForTheWorkDone() {
    let energy = samples(.activeEnergyBurned, in: HealthWorkout(ride()))
    // 200 W for 90 s is 18 kJ of work, from about 75 kJ burned.
    #expect(energy.map(\.endDate) == [start.addingTimeInterval(60), start.addingTimeInterval(90)])
    let joules = energy.map { $0.quantity.doubleValue(for: .joule()) }.reduce(0, +)
    #expect(abs(joules - 18_000 / 0.24) < 1)
  }

  @Test func namesEachSampleSoHealthKeepsOne() {
    let ride = ride()
    let names = HealthWorkout(ride).samples.map {
      $0.metadata?[HKMetadataKeySyncIdentifier] as? String
    }
    #expect(names.allSatisfy { $0?.hasPrefix(ride.id) == true })
    #expect(Set(names).count == names.count)
    #expect(
      HealthWorkout(ride).samples.map { $0.metadata?[HKMetadataKeySyncIdentifier] as? String }
        == names)
  }

  @Test func leavesOutWhatWasNotMeasured() {
    let workout = HealthWorkout(ride(power: nil))
    #expect(samples(.cyclingPower, in: workout).isEmpty)
    #expect(samples(.activeEnergyBurned, in: workout).isEmpty)
    #expect(samples(.heartRate, in: workout).count == 90)
  }

  @Test func isNamedForTheRide() {
    let ride = ride()
    let metadata = HealthWorkout(ride).metadata
    #expect(metadata[HKMetadataKeySyncIdentifier] as? String == ride.id)
    #expect(metadata[HKMetadataKeyIndoorWorkout] as? Bool == true)
  }
}
