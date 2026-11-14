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
}
