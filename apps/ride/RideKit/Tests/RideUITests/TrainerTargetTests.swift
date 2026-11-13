import RideBluetooth
import RideCore
import Testing

@testable import RideUI

struct TrainerTargetTests {
  @Test func carriesEachEngineCommandToTheTrainerUnchanged() {
    #expect(TrainerTarget(TrainerCommand.power(watts: 240)) == .power(watts: 240))
    #expect(TrainerTarget(TrainerCommand.grade(percent: -1.5)) == .grade(percent: -1.5))
    #expect(
      TrainerTarget(TrainerCommand.resistance(shareOfRange: 0.35))
        == .resistance(shareOfRange: 0.35))
  }
}
