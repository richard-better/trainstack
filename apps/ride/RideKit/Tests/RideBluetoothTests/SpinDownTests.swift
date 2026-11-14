import Foundation
import Testing

@testable import RideBluetooth

struct SpinDownTests {
  private let now = Date.now
  private let targetSpeedsFrom30Point88To36Point6 = Data([0x10, 0x0C, 0x4C, 0x0E])

  @Test func ftms4_16_2_20StartsTheSpinDownOnceInControlAndTakesTheTargetSpeedsFromTheResponse()
    throws
  {
    var control = readyControl()
    #expect(control.startSpinDown(at: now) == .requestControl)
    #expect(answer(&control, .requestControl) == .startSpinDown)
    #expect(FitnessMachineCommand.startSpinDown.data == Data([0x13, 0x01]))
    #expect(
      answer(&control, .startSpinDown, parameter: targetSpeedsFrom30Point88To36Point6) == nil)
    guard case .speedUp(let speeds) = control.spinDown else {
      Issue.record("Expected to be asked to speed up, got \(String(describing: control.spinDown))")
      return
    }
    let range = try #require(speeds)
    #expect(abs(range.lowerBound - 30.88) < 0.001)
    #expect(abs(range.upperBound - 36.6) < 0.001)
  }

  @Test
  func ftms4_17SpinDownStatusTellsTheRiderToStopPedallingThenGivesTheOutcomeAndControlIsHandedBack()
  {
    var control = spinningUp()
    #expect(control.receive(Data([0x14, 0x04]), from: .status, at: now) == nil)
    #expect(control.spinDown == .stopPedalling)
    #expect(control.receive(Data([0x14, 0x02]), from: .status, at: now) == .reset)
    #expect(control.spinDown == .succeeded)
  }

  @Test func ftms4_17AnErrorStatusFailsTheSpinDown() {
    var control = spinningUp()
    _ = control.receive(Data([0x14, 0x04]), from: .status, at: now)
    #expect(control.receive(Data([0x14, 0x03]), from: .status, at: now) == .reset)
    #expect(control.spinDown == .failed)
  }

  @Test func ftms4_3_1_2ATrainerWhoseTargetSettingFeaturesLackBit15IsNotAsked() {
    var control = readyControl()
    let powerTargetOnly = Data([0, 0, 0, 0, 0x08, 0, 0, 0])
    _ = control.receive(powerTargetOnly, from: .feature, at: now)
    #expect(control.startSpinDown(at: now) == nil)
    #expect(control.spinDown == .unsupported)
  }

  @Test func ftms4_3_1_2Bit15OfTheTargetSettingFeaturesOffersSpinDown() throws {
    let features = try #require(FitnessMachineFeatures(Data([0, 0, 0, 0, 0x08, 0x80, 0, 0])))
    #expect(features.supportsSpinDown)
  }

  @Test func ftms4_16_2_22AnOpCodeTheTrainerDoesNotSupportMeansNoSpinDown() {
    var control = readyControl()
    _ = control.startSpinDown(at: now)
    _ = answer(&control, .requestControl)
    #expect(answer(&control, .startSpinDown, with: .notSupported) == .reset)
    #expect(control.spinDown == .unsupported)
  }

  @Test func aSpinDownLeftUnansweredFailsAndHandsControlBack() {
    var control = readyControl()
    _ = control.startSpinDown(at: now)
    _ = answer(&control, .requestControl)
    #expect(control.checkForTimeouts(at: now.addingTimeInterval(1)) == nil)
    #expect(control.checkForTimeouts(at: now.addingTimeInterval(2)) == .reset)
    #expect(control.spinDown == .failed)
  }

  @Test func anUnansweredRequestForControlFailsTheSpinDown() {
    var control = readyControl()
    #expect(control.startSpinDown(at: now) == .requestControl)
    #expect(control.checkForTimeouts(at: now.addingTimeInterval(2)) == nil)
    #expect(control.spinDown == .failed)
  }

  @Test(.timeLimit(.minutes(1))) @MainActor
  func theDevicesFailACalibrationTheTrainerNeverAnswersOnTheirOwn() async throws {
    let transport = FakeTransport()
    let start = Date.now
    let clock = Clock(start)
    let devices = BluetoothDevices(
      transport: transport, defaults: isolatedDefaults(), now: { clock.date })
    let trainer = DiscoveredDevice(id: UUID(), name: "KICKR", services: [.trainer])
    transport.onAvailability?(.ready)
    devices.pair(trainer)
    transport.onConnect?(trainer.id)
    transport.onTrainerControlReady?(trainer.id)
    devices.startSpinDown(at: start)
    #expect(transport.trainerWrites == [FitnessMachineCommand.requestControl.data])
    clock.date = start.addingTimeInterval(3)
    while devices.spinDown == .starting { try await Task.sleep(for: .milliseconds(100)) }
    #expect(devices.spinDown == .failed)
  }

  @Test func aTrainerWhoseControlPointNeverGetsReadyFailsTheSpinDown() {
    var control = FitnessMachineControl()
    #expect(control.startSpinDown(at: now) == nil)
    #expect(control.checkForTimeouts(at: now.addingTimeInterval(1)) == nil)
    #expect(control.spinDown == .starting)
    #expect(control.checkForTimeouts(at: now.addingTimeInterval(2)) == nil)
    #expect(control.spinDown == .failed)
  }

  @Test func aRefusedRequestForControlFailsTheSpinDown() {
    var control = readyControl()
    _ = control.startSpinDown(at: now)
    #expect(answer(&control, .requestControl, with: .notPermitted) == nil)
    #expect(control.spinDown == .failed)
  }

  @Test func losingControlFailsTheSpinDown() {
    var control = spinningUp()
    _ = control.receive(
      Data([FitnessMachineControl.controlPermissionLostStatus]), from: .status, at: now)
    #expect(control.spinDown == .failed)
  }

  @Test func neverStartsDuringARideAndARideEndsOneUnderway() {
    var riding = readyControl()
    _ = riding.set(.power(watts: 200), at: now)
    #expect(riding.startSpinDown(at: now) == nil)
    #expect(riding.spinDown == nil)

    var control = spinningUp()
    _ = control.set(.power(watts: 200), at: now)
    #expect(control.spinDown == .failed)
  }

  @Test func ftms4_9_1ReadsTheIndoorBikeSpeedWhenTheFirstFlagBitIsClear() throws {
    let speed3456Cadence90Power200 = Data([0x44, 0, 0x80, 0x0D, 180, 0, 200, 0])
    let measurement = try #require(IndoorBikeMeasurement(speed3456Cadence90Power200))
    #expect(measurement.kilometresPerHour == 34.56)
    #expect(measurement.cadence == 90)
    #expect(measurement.watts == 200)
  }

  @Test @MainActor func theDevicesFollowTheTrainersSpinDownAndFailItWhenTheTrainerDrops() {
    let transport = FakeTransport()
    let devices = BluetoothDevices(transport: transport, defaults: isolatedDefaults())
    let trainer = DiscoveredDevice(id: UUID(), name: "KICKR", services: [.trainer])
    transport.onAvailability?(.ready)
    devices.pair(trainer)
    transport.onConnect?(trainer.id)
    transport.onTrainerControlReady?(trainer.id)
    devices.startSpinDown()
    #expect(devices.spinDown == .starting)
    transport.onTrainerValue?(trainer.id, .controlPoint, Data([0x80, 0x00, 0x01]))
    #expect(transport.trainerWrites.last == Data([0x13, 0x01]))
    transport.onTrainerValue?(
      trainer.id, .controlPoint, Data([0x80, 0x13, 0x01]) + targetSpeedsFrom30Point88To36Point6)
    #expect(devices.spinDown == .speedUp(targetKilometresPerHour: 30.88...36.6))
    transport.onCyclingMeasurement?(
      trainer.id, .indoorBike, Data([0x44, 0, 0x80, 0x0D, 180, 0, 200, 0]))
    #expect(devices.trainerKilometresPerHour == 34.56)
    transport.onDisconnect?(trainer.id)
    #expect(devices.spinDown == .failed)
    devices.endSpinDown()
    #expect(devices.spinDown == nil)
  }

  @MainActor private final class Clock {
    var date: Date
    init(_ date: Date) { self.date = date }
  }

  private func readyControl() -> FitnessMachineControl {
    var control = FitnessMachineControl()
    _ = control.becameReady(at: now)
    return control
  }

  private func spinningUp() -> FitnessMachineControl {
    var control = readyControl()
    _ = control.startSpinDown(at: now)
    _ = answer(&control, .requestControl)
    _ = answer(&control, .startSpinDown, parameter: targetSpeedsFrom30Point88To36Point6)
    return control
  }

  private func answer(
    _ control: inout FitnessMachineControl, _ command: FitnessMachineCommand,
    with result: FitnessMachineResponse.Result = .success, parameter: Data = Data()
  ) -> FitnessMachineCommand? {
    control.receive(
      Data([0x80, command.opCode, result.rawValue]) + parameter, from: .controlPoint, at: now)
  }
}
