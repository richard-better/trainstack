import Testing

@testable import RideLintRules

struct CoreImportsNoDevicesTests {
  @Test func flagsDevicesAndAppleFrameworksInTheCore() {
    let source = """
      import Foundation
      import RideData
      import RideBluetooth
      import CoreBluetooth
      @testable import RideUI
      import struct HealthKit.HKWorkout
      """
    let found = violations(
      of: CoreImportsNoDevices(), in: source, path: "RideKit/Sources/RideCore/RideEngine.swift")
    #expect(lines(found) == [3, 4, 5, 6])
  }

  @Test func keepsTheDataModuleToFoundation() {
    let source = """
      import Foundation
      import RideCore
      import SwiftUI
      """
    let found = violations(
      of: CoreImportsNoDevices(), in: source, path: "RideKit/Sources/RideData/RideSession.swift")
    #expect(lines(found) == [2, 3])
  }

  @Test func leavesTheLayerAboveAndTheTestsAlone() {
    let source = "import RideBluetooth"
    #expect(
      violations(
        of: CoreImportsNoDevices(), in: source,
        path: "RideKit/Sources/RideUI/Player/RideController.swift"
      ).isEmpty)
    #expect(
      violations(
        of: CoreImportsNoDevices(), in: source,
        path: "RideKit/Tests/RideCoreTests/RideEngineTests.swift"
      ).isEmpty)
  }
}
