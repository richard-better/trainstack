import Foundation
import RideData
import RideStrava
import Testing

@testable import RideUI

struct LibraryWorkoutDisplayTests {
  private func workout(
    _ blocks: [TrainStackWorkout.Block], sport: TrainStackWorkout.Sport = .cycling
  )
    throws -> LibraryWorkout
  {
    try LibraryWorkout(
      id: "w", workout: TrainStackWorkout(name: "W", sport: sport, blocks: blocks),
      copiedFromBuiltin: nil, updatedAt: .now)
  }

  @Test func knowsTheDurationOnlyWhenEveryStepIsTimed() throws {
    let timed = try workout([
      .step(.init(duration: .seconds(600))), .step(.init(duration: .seconds(300))),
    ])
    #expect(timed.duration == 900)
    let withDistance = try workout([
      .step(.init(duration: .seconds(600))), .step(.init(duration: .meters(5000))),
    ])
    #expect(withDistance.duration == nil)
    #expect(!withDistance.summary(ftp: 250).contains("min"))
  }

  @Test func countsTheKnownMinutesOfALapWorkoutAndSaysThereAreLaps() throws {
    let laps = try workout([
      .step(.init(duration: .seconds(600), target: .power(unit: "ftp", level: .constant(0.6)))),
      .step(
        .init(duration: .untilLap(expected: nil), target: .power(unit: "ftp", level: .constant(1)))),
    ])
    #expect(laps.duration == 600)
    #expect(laps.summary(ftp: 250) == "10 min + laps")
  }

  @Test func leavesALapWorkoutOutOfADurationFilterAndSaysItHasLapsEvenWhenUnrideable() throws {
    let laps = try workout([
      .step(.init(duration: .seconds(600))),
      .step(
        .init(
          duration: .untilLap(expected: nil),
          target: .power(unit: "ftp", level: .ramp(from: 0.5, to: 1)))),
    ])
    #expect(laps.planned == nil)
    #expect(laps.summary(ftp: 250).hasPrefix("10 min + laps"))
    var state = WorkoutsState()
    state.duration = .short
    #expect(state.filtered([laps], ftp: 250).isEmpty)
  }
}
