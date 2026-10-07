import Foundation
import Testing

@testable import RideData

struct WorkoutTests {
  private let workout = Workout(
    name: "Two steps",
    steps: [.init(duration: 3, targetPower: 100), .init(duration: 2, targetPower: 150)])

  @Test func looksUpTheTargetForEachSecond() {
    #expect(
      [0, 2, 3, 4, 5].map { workout.targetPower(at: TimeInterval($0)) } == [
        100, 100, 150, 150, nil,
      ])
  }

  @Test func appliesTheWorkoutToARecording() throws {
    let samples = (0...5).map { RideRecording.Sample(elapsed: TimeInterval($0), power: 100) }
    let ride = RideRecording(startDate: .now, samples: samples, summary: .init(duration: 5))
      .applying(workout)
    #expect(ride.workoutName == "Two steps")
    #expect(ride.samples.map(\.targetPower) == [100, 100, 100, 150, 150, nil])
    #expect(ride.hasTarget)
  }

  @Test func mergesEqualStepsIntoOneSegment() {
    let steps = [100, 100, 150].map { Workout.Step(duration: 2, targetPower: $0) }
    let samples = (0...6).map { RideRecording.Sample(elapsed: TimeInterval($0)) }
    let ride = RideRecording(startDate: .now, samples: samples, summary: .init(duration: 6))
      .applying(Workout(name: "x", steps: steps))
    #expect(
      ride.targetSegments == [
        .init(start: 0, end: 4, power: 100), .init(start: 4, end: 6, power: 150),
      ])
  }

  @Test func countsTimeWithinTolerance() {
    // 100 W target: 104 and 96 are within 5%, 106 and a missing reading are not.
    let powers: [Int?] = [100, 104, 96, 106, nil]
    let samples = powers.enumerated().map {
      RideRecording.Sample(elapsed: TimeInterval($0), power: $1, targetPower: 100)
    }
    let ride = RideRecording(startDate: .now, samples: samples, summary: .init(duration: 4))
    #expect(ride.timeOnTarget() == 3.0 / 5.0)
  }

  @Test func hasNoTimeOnTargetWithoutATarget() {
    let ride = RideRecording(
      startDate: .now, samples: [.init(elapsed: 0, power: 100)], summary: .init(duration: 0))
    #expect(ride.timeOnTarget() == nil)
    #expect(ride.targetSegments.isEmpty)
  }

  @Test func theSampleRideFollowsItsTenSteps() throws {
    let ride = try RideRecording.sample()
    #expect(ride.workoutName == "Recovery 30")
    #expect(ride.targetSegments.count == 9)  // the two 157 W steps merge
    #expect(ride.targetSegments.first == .init(start: 0, end: 180, power: 116))
    #expect(ride.targetSegments.last == .init(start: 1620, end: 1800, power: 116))
    let onTarget = try #require(ride.timeOnTarget())
    #expect((0.3...0.99).contains(onTarget))
  }
}
