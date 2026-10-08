import Foundation
import RideData
import RideLink
import Testing

@testable import RideUI

struct RideControllerTests {
  private let template = WorkoutTemplate.named("Recovery 30")!

  @Test func takesHeartRateFromARealSensorOverTheSimulator() {
    let feed = HeartRateFeed()
    let controller = RideController(
      template: template, ftp: 200, heartRate: feed, simulated: true)
    let now = Date.now
    controller.tick(seconds: 1, at: now)
    #expect(controller.session.latest.heartRateSource == .simulated)
    feed.record(152, from: .watch, at: now)
    controller.tick(seconds: 1, at: now)
    #expect(controller.session.latest.heartRate == 152)
    #expect(controller.session.latest.heartRateSource == .watch)
    feed.record(154, from: .chestStrap, at: now)
    controller.tick(seconds: 1, at: now)
    #expect(controller.session.latest.heartRate == 154)
    #expect(controller.session.latest.heartRateSource == .chestStrap)
  }

  @Test func reportsEachSecondForTheWatch() {
    let controller = RideController(template: template, ftp: 200, simulated: true)
    var glances: [RideGlance] = []
    controller.onTick = { glances.append(controller.glance) }
    controller.tick(seconds: 1)
    controller.tick(seconds: 1)
    #expect(glances.map(\.interval?.remaining) == [179, 178])
    #expect(glances.first?.workoutName == "Recovery 30")
  }
}
