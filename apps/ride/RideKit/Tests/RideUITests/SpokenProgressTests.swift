import Foundation
import RideData
import Testing

@testable import RideUI

struct SpokenProgressTests {
  private let workout = Workout(
    name: "Short", steps: [.init(duration: 120, target: .power(.constant(150)))])

  private func session(at seconds: Int) -> RideSession {
    var session = RideSession(workout: workout)
    for _ in 0..<seconds { session.advance(by: 1, reading: .init(power: 150)) }
    return session
  }

  @Test func saysHowFarThroughTheWorkoutTheRiderIs() {
    let session = session(at: 60)
    #expect(
      session.spokenProgress
        == "\(TimeInterval(60).spokenString) of \(TimeInterval(120).spokenString) done")
  }

  @Test func saysTheWorkoutIsCompleteAndHowLongTheFreeRideHasRunAfterIt() {
    #expect(
      session(at: 420).spokenProgress
        == "Workout complete, free ride \(TimeInterval(300).spokenString)")
  }
}
