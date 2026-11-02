import Foundation
import Testing

@testable import RideBluetooth

struct FitnessMachineControlTests {
  private let now = Date.now

  @Test func waitsForTheControlPointBeforeTakingControl() {
    var control = FitnessMachineControl()
    #expect(control.set(.power(watts: 200), at: now) == nil)
    #expect(control.becameReady(at: now) == .requestControl)
    #expect(answer(&control, .requestControl) == .start)
    #expect(answer(&control, .start) == .targetPower(watts: 200))
    #expect(answer(&control, .targetPower(watts: 200)) == nil)
  }

  @Test func sendsOnlyTheLatestTargetOnceTheLastIsAnswered() {
    var control = controlAfterStart(aimingAt: .power(watts: 200))
    #expect(control.set(.power(watts: 210), at: now) == nil)
    #expect(control.set(.grade(percent: 3), at: now) == nil)
    #expect(answer(&control, .targetPower(watts: 200)) == .simulation(gradePercent: 3))
    #expect(answer(&control, .simulation(gradePercent: 3)) == nil)
    #expect(control.set(.grade(percent: 3), at: now) == nil)
  }

  @Test func givesUpOnACommandLeftUnanswered() {
    var control = FitnessMachineControl()
    _ = control.set(.power(watts: 200), at: now)
    _ = control.becameReady(at: now)
    #expect(control.set(.power(watts: 200), at: now.addingTimeInterval(1)) == nil)
    #expect(control.set(.power(watts: 200), at: now.addingTimeInterval(2)) == .requestControl)
  }

  @Test func asksAgainAfterARefusalOnlyOnceItHasWaited() {
    var control = FitnessMachineControl()
    _ = control.set(.power(watts: 200), at: now)
    _ = control.becameReady(at: now)
    #expect(answer(&control, .requestControl, with: .notPermitted) == nil)
    #expect(control.set(.power(watts: 200), at: now.addingTimeInterval(4)) == nil)
    #expect(control.set(.power(watts: 200), at: now.addingTimeInterval(5)) == .requestControl)
  }

  @Test func takesControlAgainWhenTheTrainerLetsGo() {
    var control = controlAfterStart(aimingAt: .power(watts: 200))
    _ = answer(&control, .targetPower(watts: 200))
    #expect(control.receive(Data([0xFF]), from: .status, at: now) == .requestControl)
    #expect(answer(&control, .requestControl) == .start)
    #expect(answer(&control, .start) == .targetPower(watts: 200))
    #expect(answer(&control, .targetPower(watts: 200), with: .notPermitted) == .requestControl)
  }

  @Test(arguments: [
    FitnessMachineControl.resetStatus, FitnessMachineControl.controlPermissionLostStatus,
  ])
  func asksForControlAgainOnAStatusThatEndsIt(status: UInt8) {
    var control = controlAfterStart(aimingAt: .power(watts: 200))
    _ = answer(&control, .targetPower(watts: 200))
    #expect(control.receive(Data([status]), from: .status, at: now) == .requestControl)
  }

  @Test func aTrainerAlreadyRunningFailsTheStartAndTakesTargetsAllTheSame() {
    var control = FitnessMachineControl()
    _ = control.set(.power(watts: 200), at: now)
    _ = control.becameReady(at: now)
    _ = answer(&control, .requestControl)
    #expect(answer(&control, .start, with: .failed) == .targetPower(watts: 200))
  }

  @Test func doesNotRepeatATargetTheTrainerRejects() {
    var control = controlAfterStart(aimingAt: .grade(percent: 4))
    #expect(answer(&control, .simulation(gradePercent: 4), with: .notSupported) == nil)
    #expect(control.set(.grade(percent: 4), at: now) == nil)
  }

  @Test func resetsTheTrainerToHandBackControl() {
    var control = controlAfterStart(aimingAt: .power(watts: 200))
    _ = answer(&control, .targetPower(watts: 200))
    #expect(control.set(nil, at: now) == .reset)
    #expect(answer(&control, .reset) == nil)
    #expect(control.set(.power(watts: 200), at: now) == .requestControl)
  }

  @Test func ignoresAnswersToOtherCommands() {
    var control = controlAfterStart(aimingAt: .power(watts: 200))
    #expect(answer(&control, .simulation(gradePercent: 1)) == nil)
    #expect(control.set(.power(watts: 220), at: now) == nil)
  }

  @Test func keepsPowerWithinTheTrainersRange() {
    var control = controlAfterStart(aimingAt: .power(watts: 2500))
    _ = control.receive(Data([0, 0, 0xD0, 0x07, 1, 0]), from: .powerRange, at: now)
    #expect(answer(&control, .targetPower(watts: 2500)) == nil)
    #expect(control.set(.power(watts: 2400), at: now) == .targetPower(watts: 2000))
  }

  @Test func mapsResistanceOntoTheTrainersRangeOnceItIsKnown() {
    var control = controlAfterStart(
      aimingAt: .resistance(shareOfRange: 0.5), sendsTargetOnStart: false)
    #expect(
      control.receive(Data([0, 0, 200, 0, 10, 0]), from: .resistanceRange, at: now)
        == .targetResistance(level: 100, wide: false))
    #expect(
      answer(&control, .targetResistance(level: 100, wide: false)) == nil)
    _ = control.receive(Data([0, 0, 0xE8, 0x03, 1, 0]), from: .resistanceRange, at: now)
    #expect(
      control.set(.resistance(shareOfRange: 1), at: now)
        == .targetResistance(level: 1000, wide: true))
  }

  private func controlAfterStart(
    aimingAt target: TrainerTarget, sendsTargetOnStart: Bool = true
  ) -> FitnessMachineControl {
    var control = FitnessMachineControl()
    _ = control.set(target, at: now)
    _ = control.becameReady(at: now)
    _ = answer(&control, .requestControl)
    let first = answer(&control, .start)
    #expect((first != nil) == sendsTargetOnStart)
    return control
  }

  private func answer(
    _ control: inout FitnessMachineControl, _ command: FitnessMachineCommand,
    with result: FitnessMachineResponse.Result = .success
  ) -> FitnessMachineCommand? {
    control.receive(Data([0x80, command.opCode, result.rawValue]), from: .controlPoint, at: now)
  }
}
