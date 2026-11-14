import RideData
import Testing

@testable import RideUI

struct WorkoutTargetBarTests {
  private let session = RideSession(
    workout: PlannedWorkout(
      name: "Bars", category: nil,
      steps: [
        PlannedStep(duration: 60, target: .shareOfFTP(.ramp(from: 0.5, to: 1))),
        PlannedStep(duration: 30, target: .shareOfFTP(.range(low: 0.9, high: 1.1))),
        PlannedStep(duration: 30, target: nil),
      ]
    ).workout(ftp: 200))

  @Test func drawsARampAsSlicesThatClimbWithIt() {
    let ramp = WorkoutTargetBar.bars(of: session).filter { $0.interval.index == 0 }
    #expect(ramp.count == 6)
    #expect(ramp.map(\.watts) == [108, 125, 142, 158, 175, 192])
    #expect(ramp.first?.start == 0)
    #expect(ramp.last?.end == 60)
  }

  @Test func drawsARangeAroundTheMiddleErgHolds() {
    let range = WorkoutTargetBar.bars(of: session).first { $0.interval.index == 1 }
    #expect(range?.watts == 200)
    #expect(range?.range == 180...220)
  }

  @Test func drawsAFreeRideWithoutWatts() {
    let free = WorkoutTargetBar.bars(of: session).first { $0.interval.index == 2 }
    #expect(free?.watts == nil)
    #expect(free?.range == nil)
  }

  @Test func everyBarHasItsOwnIdentityEvenWithoutLength() {
    let session = RideSession(
      workout: PlannedWorkout(
        name: "Laps", category: nil,
        steps: [
          PlannedStep(duration: 0, target: nil, untilLap: UntilLap()),
          PlannedStep(duration: 0, target: nil, untilLap: UntilLap()),
          PlannedStep(duration: 60, target: .shareOfFTP(.ramp(from: 0.5, to: 1))),
        ]
      ).workout(ftp: 200))
    let ids = WorkoutTargetBar.bars(of: session).map(\.id)
    #expect(Set(ids).count == ids.count)
  }
}
