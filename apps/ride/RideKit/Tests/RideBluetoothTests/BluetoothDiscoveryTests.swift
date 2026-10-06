import Foundation
import Testing

@testable import RideBluetooth

@MainActor
struct BluetoothDiscoveryTests {
  @Test func waitsForBluetoothBeforeScanning() {
    let transport = FakeDiscoveryTransport()
    let discovery = BluetoothDiscovery(transport: transport)
    discovery.startScanning()
    #expect(transport.started)
    #expect(transport.scans.isEmpty)
    transport.onAvailability?(.ready)
    #expect(discovery.isScanning)
    #expect(transport.scans == [false])
    discovery.startScanning()
    #expect(transport.scans == [false])
  }

  @Test func deduplicatesAdvertisementsAndPreservesKnownDetails() {
    let (discovery, transport) = scanningDiscovery()
    let id = UUID()
    transport.onDiscovery?(.init(id: id, services: [.trainer]))
    transport.onDiscovery?(.init(id: id, name: "KICKR CORE", services: [.power]))
    transport.onDiscovery?(.init(id: id))
    #expect(discovery.devices == [.init(id: id, name: "KICKR CORE", services: [.trainer, .power])])
  }

  @Test func showAllRestartsScanAndFiltersByAdvertisedServices() {
    let (discovery, transport) = scanningDiscovery()
    transport.onDiscovery?(.init(id: UUID(), name: "Living Room"))
    transport.onDiscovery?(.init(id: UUID(), name: "Polar H10", services: [.heartRate]))
    #expect(discovery.devices.map(\.displayName) == ["Polar H10"])
    discovery.showAll = true
    #expect(transport.scans == [false, true])
    #expect(transport.stops == 1)
    #expect(discovery.devices.map(\.displayName) == ["Living Room", "Polar H10"])
    discovery.showAll = false
    #expect(transport.scans == [false, true, false])
    #expect(discovery.devices.map(\.displayName) == ["Polar H10"])
  }

  @Test func powerLossClearsDevicesAndResumesWhenReady() {
    let (discovery, transport) = scanningDiscovery()
    transport.onDiscovery?(.init(id: UUID(), name: "Trainer", services: [.trainer]))
    transport.onAvailability?(.poweredOff)
    #expect(!discovery.isScanning)
    #expect(discovery.devices.isEmpty)
    transport.onAvailability?(.ready)
    #expect(discovery.isScanning)
    #expect(transport.scans == [false, false])
  }

  @Test func closingStopsDiscoveryAndIgnoresLateCallbacks() {
    let (discovery, transport) = scanningDiscovery()
    discovery.stopScanning()
    transport.onDiscovery?(.init(id: UUID(), name: "Late sensor", services: [.heartRate]))
    transport.onAvailability?(.ready)
    discovery.showAll = true
    #expect(!discovery.isScanning)
    #expect(discovery.devices.isEmpty)
    #expect(transport.scans == [false])
    #expect(transport.stops == 1)
  }

  @Test func reopeningStartsAFreshSearch() {
    let (discovery, transport) = scanningDiscovery()
    transport.onDiscovery?(.init(id: UUID(), name: "Old sensor", services: [.heartRate]))
    discovery.stopScanning()
    discovery.showAll = true
    discovery.startScanning()
    #expect(discovery.devices.isEmpty)
    #expect(transport.scans == [false, true])
  }

  @Test(arguments: [BluetoothAvailability.unauthorized, .unsupported, .resetting])
  func unavailableBluetoothDoesNotScan(state: BluetoothAvailability) {
    let transport = FakeDiscoveryTransport()
    let discovery = BluetoothDiscovery(transport: transport)
    transport.onAvailability?(state)
    discovery.startScanning()
    #expect(discovery.availability == state)
    #expect(!discovery.isScanning)
    #expect(transport.scans.isEmpty)
  }

  private func scanningDiscovery() -> (BluetoothDiscovery, FakeDiscoveryTransport) {
    let transport = FakeDiscoveryTransport()
    let discovery = BluetoothDiscovery(transport: transport)
    transport.onAvailability?(.ready)
    discovery.startScanning()
    return (discovery, transport)
  }
}

@MainActor
private final class FakeDiscoveryTransport: DiscoveryTransport {
  var onAvailability: ((BluetoothAvailability) -> Void)?
  var onDiscovery: ((DiscoveredDevice) -> Void)?
  var started = false
  var scans: [Bool] = []
  var stops = 0

  func start() { started = true }
  func scan(showAll: Bool) { scans.append(showAll) }
  func stopScan() { stops += 1 }
}
