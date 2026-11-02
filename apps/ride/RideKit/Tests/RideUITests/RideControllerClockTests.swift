import Foundation
import RideData
import Testing

@testable import RideUI

struct RideControllerClockTests {
  @Test func aTickThatComesAHairBeforeASecondStillMovesTheRideOn() {
    let controller = RideController(
      template: WorkoutTemplate.named("Recovery 30")!, ftp: 200, simulated: true)
    controller.start()
    defer { controller.stop() }
    controller.tickIfDue(at: .now + .milliseconds(950))
    #expect(controller.session.elapsed > 0.9)
  }
}
