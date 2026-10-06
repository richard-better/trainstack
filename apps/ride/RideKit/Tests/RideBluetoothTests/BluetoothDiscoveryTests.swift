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
    #expect(transport.scans == 0)
    transport.onAvailability?(.ready)
    #expect(discovery.isScanning)
    #expect(transport.scans == 1)
    discovery.startScanning()
    #expect(transport.scans == 1)
  }

  @Test func deduplicatesAdvertisementsAndPreservesKnownDetails() {
    let (discovery, transport) = scanningDiscovery()
    let id = UUID()
    transport.onDiscovery?(.init(id: id, services: [.trainer]))
    transport.onDiscovery?(.init(id: id, name: "KICKR CORE", services: [.power]))
    transport.onDiscovery?(.init(id: id))
    #expect(
      discovery.fitnessDevices == [.init(id: id, name: "KICKR CORE", services: [.trainer, .power])])
  }

  @Test func separatesFitnessDevicesFromOtherBluetoothDevices() {
    let (discovery, transport) = scanningDiscovery()
    transport.onDiscovery?(.init(id: UUID(), name: "Living Room"))
    transport.onDiscovery?(.init(id: UUID(), name: "Polar H10", services: [.heartRate]))
    transport.onDiscovery?(.init(id: UUID(), name: "AirPods"))
    #expect(discovery.fitnessDevices.map(\.displayName) == ["Polar H10"])
    #expect(discovery.otherDevices.map(\.displayName) == ["AirPods", "Living Room"])
  }

  @Test func powerLossClearsDevicesAndResumesWhenReady() {
    let (discovery, transport) = scanningDiscovery()
    transport.onDiscovery?(.init(id: UUID(), name: "Trainer", services: [.trainer]))
    transport.onAvailability?(.poweredOff)
    #expect(!discovery.isScanning)
    #expect(discovery.fitnessDevices.isEmpty && discovery.otherDevices.isEmpty)
    transport.onAvailability?(.ready)
    #expect(discovery.isScanning)
    #expect(transport.scans == 2)
  }

  @Test func closingStopsDiscoveryAndIgnoresLateCallbacks() {
    let (discovery, transport) = scanningDiscovery()
    discovery.stopScanning()
    transport.onDiscovery?(.init(id: UUID(), name: "Late sensor", services: [.heartRate]))
    transport.onAvailability?(.ready)
    #expect(!discovery.isScanning)
    #expect(discovery.fitnessDevices.isEmpty && discovery.otherDevices.isEmpty)
    #expect(transport.scans == 1)
    #expect(transport.stops == 1)
  }

  @Test func reopeningStartsAFreshSearch() {
    let (discovery, transport) = scanningDiscovery()
    transport.onDiscovery?(.init(id: UUID(), name: "Old sensor", services: [.heartRate]))
    discovery.stopScanning()
    discovery.startScanning()
    #expect(discovery.fitnessDevices.isEmpty && discovery.otherDevices.isEmpty)
    #expect(transport.scans == 2)
  }

  @Test(arguments: [BluetoothAvailability.unauthorized, .unsupported, .resetting])
  func unavailableBluetoothDoesNotScan(state: BluetoothAvailability) {
    let transport = FakeDiscoveryTransport()
    let discovery = BluetoothDiscovery(transport: transport)
    transport.onAvailability?(state)
    discovery.startScanning()
    #expect(discovery.availability == state)
    #expect(!discovery.isScanning)
    #expect(transport.scans == 0)
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
  var scans = 0
  var stops = 0

  func start() { started = true }
  func scan() { scans += 1 }
  func stopScan() { stops += 1 }
}
