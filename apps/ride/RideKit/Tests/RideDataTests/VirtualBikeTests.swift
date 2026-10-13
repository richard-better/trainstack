import Foundation
import Testing

@testable import RideData

struct VirtualBikeTests {
  /// Rides `seconds` one second at a time, as the player does, and returns the metres covered.
  @discardableResult
  private func ride(
    _ bike: inout VirtualBike, power: Double, grade: Double = 0, seconds: Int
  ) -> Double {
    (0..<seconds).reduce(0) { distance, _ in
      distance + bike.ride(power: power, grade: grade, for: 1)
    }
  }

  private func steadySpeed(power: Double, grade: Double = 0, riderWeight: Double = 75) -> Double {
    var bike = VirtualBike(riderWeight: riderWeight)
    ride(&bike, power: power, grade: grade, seconds: 600)
    return bike.speed * 3.6
  }

  @Test func ridesAboutTwentySevenKilometresAnHourAtEasyPowerOnTheFlat() {
    #expect((26...29).contains(steadySpeed(power: 115)))
  }

  @Test func buildsSpeedGraduallyFromRest() {
    var bike = VirtualBike(riderWeight: 75)
    ride(&bike, power: 115, seconds: 3)
    #expect(bike.speed * 3.6 > 5)
    #expect(bike.speed * 3.6 < 20)
  }

  @Test func coastsToAStopRatherThanAtOnce() {
    var bike = VirtualBike(riderWeight: 75)
    ride(&bike, power: 115, seconds: 600)
    let cruising = bike.speed
    ride(&bike, power: 0, seconds: 5)
    #expect(bike.speed > cruising * 0.7)
    #expect(bike.speed < cruising * 0.95)
    ride(&bike, power: 0, seconds: 600)
    #expect(bike.speed == 0)
  }

  @Test func barelySlowsForAMomentOffThePedals() {
    var bike = VirtualBike(riderWeight: 75)
    ride(&bike, power: 200, seconds: 600)
    let cruising = bike.speed
    bike.ride(power: 0, grade: 0, for: 0.5)
    #expect(bike.speed > cruising * 0.97)
  }

  @Test func climbsSlowerThanItRidesTheFlat() {
    #expect(steadySpeed(power: 200, grade: 0.05) < steadySpeed(power: 200) * 0.6)
  }

  @Test func aHeavierRiderClimbsSlower() {
    let light = steadySpeed(power: 200, grade: 0.06, riderWeight: 60)
    let heavy = steadySpeed(power: 200, grade: 0.06, riderWeight: 90)
    #expect(heavy < light * 0.8)
  }

  @Test func rollsDownASteepDescentWithoutPedalling() {
    var bike = VirtualBike(riderWeight: 75)
    ride(&bike, power: 0, grade: -0.06, seconds: 60)
    #expect(bike.speed * 3.6 > 40)
  }

  @Test func coversTheDistanceOfItsSpeed() {
    var bike = VirtualBike(riderWeight: 75)
    ride(&bike, power: 150, seconds: 600)
    let speed = bike.speed
    let distance = ride(&bike, power: 150, seconds: 60)
    #expect(abs(distance - speed * 60) < 1)
  }

  @Test func takesALateTickInStepsAsIfOnTime() {
    var once = VirtualBike(riderWeight: 75)
    var everySecond = VirtualBike(riderWeight: 75)
    let distance = once.ride(power: 150, grade: 0, for: 30)
    let distanceEverySecond = ride(&everySecond, power: 150, seconds: 30)
    #expect(abs(once.speed - everySecond.speed) < 0.01)
    #expect(abs(distance - distanceEverySecond) < 0.1)
  }
}
