import Foundation
import Testing

@testable import RideBluetooth

struct FitnessMachineCommandTests {
  @Test func encodesTheControlPointCommands() {
    #expect(FitnessMachineCommand.requestControl.data == Data([0x00]))
    #expect(FitnessMachineCommand.reset.data == Data([0x01]))
    #expect(FitnessMachineCommand.start.data == Data([0x07]))
    #expect(FitnessMachineCommand.targetPower(250).data == Data([0x05, 250, 0]))
    #expect(FitnessMachineCommand.targetPower(300).data == Data([0x05, 0x2C, 0x01]))
  }

  @Test func sendsResistanceInOneByteUnlessTheRangeNeedsTwo() {
    #expect(FitnessMachineCommand.targetResistance(120, wide: false).data == Data([0x04, 120]))
    #expect(
      FitnessMachineCommand.targetResistance(800, wide: true).data == Data([0x04, 0x20, 0x03]))
  }

  @Test func simulatesARoadOfTheGradeWithoutWind() {
    #expect(
      FitnessMachineCommand.simulation(grade: 2.5).data == Data([0x11, 0, 0, 250, 0, 40, 51]))
    #expect(
      FitnessMachineCommand.simulation(grade: -1).data
        == Data([0x11, 0, 0, 0x9C, 0xFF, 40, 51]))
  }

  @Test func readsResponsesToCommands() {
    #expect(
      FitnessMachineResponse(Data([0x80, 0x05, 0x01]))
        == FitnessMachineResponse(opCode: 0x05, result: .success))
    #expect(
      FitnessMachineResponse(Data([0x80, 0x00, 0x05]))
        == FitnessMachineResponse(opCode: 0x00, result: .notPermitted))
    #expect(FitnessMachineResponse(Data([0x80, 0x11, 0x09]))?.result == .failed)
    #expect(FitnessMachineResponse(Data([0x05, 0x01, 0x01])) == nil)
    #expect(FitnessMachineResponse(Data([0x80, 0x05])) == nil)
  }

  @Test func readsSupportedRangesAndSnapsToTheirSteps() {
    let power = FitnessMachineRange(Data([0, 0, 0xD0, 0x07, 1, 0]))
    #expect(power == FitnessMachineRange(minimum: 0, maximum: 2000, increment: 1))
    let resistance = FitnessMachineRange(minimum: 10, maximum: 200, increment: 10)
    #expect(resistance.nearest(104) == 100)
    #expect(resistance.nearest(106) == 110)
    #expect(resistance.nearest(0) == 10)
    #expect(resistance.nearest(500) == 200)
    #expect(FitnessMachineRange(Data([0xF6, 0xFF, 0x64, 0, 1, 0]))?.minimum == -10)
    #expect(FitnessMachineRange(Data([0x64, 0, 0, 0, 1, 0])) == nil)
    #expect(FitnessMachineRange(Data([0, 0, 0x64, 0])) == nil)
  }
}
