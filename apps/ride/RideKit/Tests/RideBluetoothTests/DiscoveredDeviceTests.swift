import Foundation
import Testing

@testable import RideBluetooth

struct DiscoveredDeviceTests {
  @Test func isTheMostCapableKindItAdvertises() {
    let trainer = DiscoveredDevice(id: UUID(), services: [.speedAndCadence, .power, .trainer])
    let meter = DiscoveredDevice(id: UUID(), services: [.speedAndCadence, .power])
    let strap = DiscoveredDevice(id: UUID(), services: [.speedAndCadence, .heartRate])
    #expect(trainer.kind == .trainer)
    #expect(meter.kind == .power)
    #expect(strap.kind == .heartRate)
    #expect(DiscoveredDevice(id: UUID()).kind == nil)
  }
}
