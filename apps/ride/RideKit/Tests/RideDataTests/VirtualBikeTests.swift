import Foundation
import Testing

@testable import RideData

struct VirtualBikeTests {
  @discardableResult
  private func ride(
    _ bike: inout VirtualBike, power: Double, gradeFraction: Double = 0, seconds: Int
  ) -> Double {
    (0..<seconds).reduce(0) { distance, _ in
      distance + bike.ride(power: power, gradeFraction: gradeFraction, for: 1)
    }
  }

  private func steadySpeed(power: Double, gradeFraction: Double = 0, riderWeight: Double = 75)
    -> Double
  {
    var bike = VirtualBike(riderWeight: riderWeight)
    ride(&bike, power: power, gradeFraction: gradeFraction, seconds: 600)
    return bike.speedMetresPerSecond * 3.6
  }

  @Test func carriesTheBikeAsWellAsTheRider() {
    #expect(VirtualBike(riderWeight: 75).riderAndBikeMass == 75 + VirtualBike.bikeMass)
  }

  @Test func ridesAboutTwentySevenKilometresAnHourAtEasyPowerOnTheFlat() {
    #expect((26...29).contains(steadySpeed(power: 115)))
  }

  @Test func buildsSpeedGraduallyFromRest() {
    var bike = VirtualBike(riderWeight: 75)
    ride(&bike, power: 115, seconds: 3)
    #expect(bike.speedMetresPerSecond * 3.6 > 5)
    #expect(bike.speedMetresPerSecond * 3.6 < 20)
  }

  @Test func coastsToAStopRatherThanAtOnce() {
    var bike = VirtualBike(riderWeight: 75)
    ride(&bike, power: 115, seconds: 600)
    let cruising = bike.speedMetresPerSecond
    ride(&bike, power: 0, seconds: 5)
    #expect(bike.speedMetresPerSecond > cruising * 0.7)
    #expect(bike.speedMetresPerSecond < cruising * 0.95)
    ride(&bike, power: 0, seconds: 600)
    #expect(bike.speedMetresPerSecond == 0)
  }

  @Test func barelySlowsForAMomentOffThePedals() {
    var bike = VirtualBike(riderWeight: 75)
    ride(&bike, power: 200, seconds: 600)
    let cruising = bike.speedMetresPerSecond
    bike.ride(power: 0, gradeFraction: 0, for: 0.5)
    #expect(bike.speedMetresPerSecond > cruising * 0.97)
  }

  @Test func climbsSlowerThanItRidesTheFlat() {
    #expect(steadySpeed(power: 200, gradeFraction: 0.05) < steadySpeed(power: 200) * 0.6)
  }

  @Test func aHeavierRiderClimbsSlower() {
    let light = steadySpeed(power: 200, gradeFraction: 0.06, riderWeight: 60)
    let heavy = steadySpeed(power: 200, gradeFraction: 0.06, riderWeight: 90)
    #expect(heavy < light * 0.8)
  }

  @Test func rollsDownASteepDescentWithoutPedalling() {
    var bike = VirtualBike(riderWeight: 75)
    ride(&bike, power: 0, gradeFraction: -0.06, seconds: 60)
    #expect(bike.speedMetresPerSecond * 3.6 > 40)
  }

  @Test func coversTheDistanceOfItsSpeed() {
    var bike = VirtualBike(riderWeight: 75)
    ride(&bike, power: 150, seconds: 600)
    let speed = bike.speedMetresPerSecond
    let distance = ride(&bike, power: 150, seconds: 60)
    #expect(abs(distance - speed * 60) < 1)
  }

  @Test func takesALateTickInStepsAsIfOnTime() {
    var once = VirtualBike(riderWeight: 75)
    var everySecond = VirtualBike(riderWeight: 75)
    let distance = once.ride(power: 150, gradeFraction: 0, for: 30)
    let distanceEverySecond = ride(&everySecond, power: 150, seconds: 30)
    #expect(abs(once.speedMetresPerSecond - everySecond.speedMetresPerSecond) < 0.01)
    #expect(abs(distance - distanceEverySecond) < 0.1)
  }
}
