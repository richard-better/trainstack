import Foundation
import Testing

@testable import RideBluetooth

struct FitnessMachineControlTests {
  private let now = Date.now

  @Test func waitsForTheControlPointBeforeTakingControl() {
    var control = FitnessMachineControl()
    #expect(control.set(.power(200), at: now) == nil)
    #expect(control.becameReady(at: now) == .requestControl)
    #expect(answer(&control, .requestControl) == .start)
    #expect(answer(&control, .start) == .targetPower(200))
    #expect(answer(&control, .targetPower(200)) == nil)
  }

  @Test func sendsOnlyTheLatestTargetOnceTheLastIsAnswered() {
    var control = controlling(.power(200))
    #expect(control.set(.power(210), at: now) == nil)
    #expect(control.set(.grade(3), at: now) == nil)
    #expect(answer(&control, .targetPower(200)) == .simulation(grade: 3))
    #expect(answer(&control, .simulation(grade: 3)) == nil)
    #expect(control.set(.grade(3), at: now) == nil)
  }

  @Test func givesUpOnACommandLeftUnanswered() {
    var control = FitnessMachineControl()
    _ = control.set(.power(200), at: now)
    _ = control.becameReady(at: now)
    #expect(control.set(.power(200), at: now.addingTimeInterval(1)) == nil)
    #expect(control.set(.power(200), at: now.addingTimeInterval(2)) == .requestControl)
  }

  @Test func asksAgainAfterARefusalOnlyOnceItHasWaited() {
    var control = FitnessMachineControl()
    _ = control.set(.power(200), at: now)
    _ = control.becameReady(at: now)
    #expect(answer(&control, .requestControl, with: .notPermitted) == nil)
    #expect(control.set(.power(200), at: now.addingTimeInterval(4)) == nil)
    #expect(control.set(.power(200), at: now.addingTimeInterval(5)) == .requestControl)
  }

  @Test func takesControlAgainWhenTheTrainerLetsGo() {
    var control = controlling(.power(200))
    _ = answer(&control, .targetPower(200))
    #expect(control.receive(Data([0xFF]), from: .status, at: now) == .requestControl)
    #expect(answer(&control, .requestControl) == .start)
    #expect(answer(&control, .start) == .targetPower(200))
    #expect(answer(&control, .targetPower(200), with: .notPermitted) == .requestControl)
  }

  @Test func doesNotRepeatATargetTheTrainerRejects() {
    var control = controlling(.grade(4))
    #expect(answer(&control, .simulation(grade: 4), with: .notSupported) == nil)
    #expect(control.set(.grade(4), at: now) == nil)
  }

  @Test func resetsTheTrainerToHandBackControl() {
    var control = controlling(.power(200))
    _ = answer(&control, .targetPower(200))
    #expect(control.set(nil, at: now) == .reset)
    #expect(answer(&control, .reset) == nil)
    #expect(control.set(.power(200), at: now) == .requestControl)
  }

  @Test func ignoresAnswersToOtherCommands() {
    var control = controlling(.power(200))
    #expect(answer(&control, .simulation(grade: 1)) == nil)
    #expect(control.set(.power(220), at: now) == nil)
  }

  @Test func keepsPowerWithinTheTrainersRange() {
    var control = controlling(.power(2500))
    _ = control.receive(Data([0, 0, 0xD0, 0x07, 1, 0]), from: .powerRange, at: now)
    #expect(answer(&control, .targetPower(2500)) == nil)
    #expect(control.set(.power(2400), at: now) == .targetPower(2000))
  }

  @Test func mapsResistanceOntoTheTrainersRangeOnceItIsKnown() {
    var control = controlling(.resistance(0.5), sentFirst: false)
    #expect(
      control.receive(Data([0, 0, 200, 0, 10, 0]), from: .resistanceRange, at: now)
        == .targetResistance(100, wide: false))
    #expect(
      answer(&control, .targetResistance(100, wide: false)) == nil)
    _ = control.receive(Data([0, 0, 0xE8, 0x03, 1, 0]), from: .resistanceRange, at: now)
    #expect(control.set(.resistance(1), at: now) == .targetResistance(1000, wide: true))
  }

  /// A control that has taken control and sent, or is ready to send, `target`.
  private func controlling(
    _ target: TrainerTarget, sentFirst: Bool = true
  ) -> FitnessMachineControl {
    var control = FitnessMachineControl()
    _ = control.set(target, at: now)
    _ = control.becameReady(at: now)
    _ = answer(&control, .requestControl)
    let first = answer(&control, .start)
    #expect((first != nil) == sentFirst)
    return control
  }

  private func answer(
    _ control: inout FitnessMachineControl, _ command: FitnessMachineCommand,
    with result: FitnessMachineResponse.Result = .success
  ) -> FitnessMachineCommand? {
    control.receive(Data([0x80, command.opCode, result.rawValue]), from: .controlPoint, at: now)
  }
}
