import Foundation
import RideData
import Testing

@testable import RideUI

struct WorkoutTargetBarRampTests {
  private let ramp = PlannedWorkout(
    name: "Ramp", category: nil,
    steps: [
      PlannedStep(duration: 60, target: .watts(.ramp(from: 100, to: 300))),
      PlannedStep(duration: 60, target: .watts(.constant(150))),
    ])

  private func ride(_ session: inout RideSession, seconds: Int) {
    for _ in 0..<seconds { session.advance(by: 1, reading: .init(power: 200)) }
  }

  @Test func anExtendedRampIsDrawnHoldingItsLastTargetToItsNewEnd() {
    var session = RideSession(workout: ramp.workout(ftp: 250))
    ride(&session, seconds: 10)
    session.extendInterval(by: 60)
    let bars = WorkoutTargetBar.bars(of: session).filter { $0.interval.index == 0 }
    #expect(bars.last?.end == 120)
    #expect(bars.last?.watts == 300)
  }

  @Test func aRampCutShortByGoingBackIsDrawnOnlyAsFarAsItWasRidden() {
    var session = RideSession(workout: ramp.workout(ftp: 250))
    ride(&session, seconds: 30)
    session.previousInterval()
    let bars = WorkoutTargetBar.bars(of: session)
    let cut = bars.filter { $0.interval.index == 0 }
    #expect(cut.last?.end == 30)
    #expect(cut.allSatisfy { ($0.watts ?? 0) < 210 })
    #expect(bars.filter { $0.interval.index == 1 }.first?.start == 30)
  }
}
