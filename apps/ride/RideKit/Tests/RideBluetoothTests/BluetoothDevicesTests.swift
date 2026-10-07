import Foundation
import Testing

@testable import RideBluetooth

@MainActor
struct BluetoothDevicesTests {
  @Test func waitsForBluetoothBeforeScanning() {
    let transport = FakeTransport()
    let devices = BluetoothDevices(transport: transport)
    devices.startScanning()
    #expect(transport.started)
    #expect(transport.scans == 0)
    transport.onAvailability?(.ready)
    #expect(devices.isScanning)
    #expect(transport.scans == 1)
    devices.startScanning()
    #expect(transport.scans == 1)
  }

  @Test func deduplicatesAdvertisementsAndPreservesKnownDetails() {
    let (devices, transport) = scanningDevices()
    let id = UUID()
    transport.onDiscovery?(.init(id: id, services: [.trainer]))
    transport.onDiscovery?(.init(id: id, name: "KICKR CORE", services: [.power]))
    transport.onDiscovery?(.init(id: id))
    #expect(
      devices.fitnessDevices == [.init(id: id, name: "KICKR CORE", services: [.trainer, .power])])
  }

  @Test func separatesFitnessDevicesFromOtherBluetoothDevices() {
    let (devices, transport) = scanningDevices()
    transport.onDiscovery?(.init(id: UUID(), name: "Living Room"))
    transport.onDiscovery?(.init(id: UUID(), name: "Polar H10", services: [.heartRate]))
    transport.onDiscovery?(.init(id: UUID(), name: "AirPods"))
    #expect(devices.fitnessDevices.map(\.displayName) == ["Polar H10"])
    #expect(devices.otherDevices.map(\.displayName) == ["AirPods", "Living Room"])
  }

  @Test func powerLossClearsDevicesAndResumesWhenReady() {
    let (devices, transport) = scanningDevices()
    transport.onDiscovery?(.init(id: UUID(), name: "Trainer", services: [.trainer]))
    transport.onAvailability?(.poweredOff)
    #expect(!devices.isScanning)
    #expect(devices.fitnessDevices.isEmpty && devices.otherDevices.isEmpty)
    transport.onAvailability?(.ready)
    #expect(devices.isScanning)
    #expect(transport.scans == 2)
  }

  @Test func closingStopsDiscoveryAndIgnoresLateCallbacks() {
    let (devices, transport) = scanningDevices()
    devices.stopScanning()
    transport.onDiscovery?(.init(id: UUID(), name: "Late sensor", services: [.heartRate]))
    transport.onAvailability?(.ready)
    #expect(!devices.isScanning)
    #expect(devices.fitnessDevices.isEmpty && devices.otherDevices.isEmpty)
    #expect(transport.scans == 1)
    #expect(transport.stops == 1)
  }

  @Test func reopeningStartsAFreshSearch() {
    let (devices, transport) = scanningDevices()
    transport.onDiscovery?(.init(id: UUID(), name: "Old sensor", services: [.heartRate]))
    devices.stopScanning()
    devices.startScanning()
    #expect(devices.fitnessDevices.isEmpty && devices.otherDevices.isEmpty)
    #expect(transport.scans == 2)
  }

  @Test(arguments: [BluetoothAvailability.unauthorized, .unsupported, .resetting])
  func unavailableBluetoothDoesNotScan(state: BluetoothAvailability) {
    let transport = FakeTransport()
    let devices = BluetoothDevices(transport: transport)
    transport.onAvailability?(state)
    devices.startScanning()
    #expect(devices.availability == state)
    #expect(!devices.isScanning)
    #expect(transport.scans == 0)
  }

  private func scanningDevices() -> (BluetoothDevices, FakeTransport) {
    let transport = FakeTransport()
    let devices = BluetoothDevices(transport: transport)
    transport.onAvailability?(.ready)
    devices.startScanning()
    return (devices, transport)
  }
}

@MainActor
private final class FakeTransport: BluetoothTransport {
  var onAvailability: ((BluetoothAvailability) -> Void)?
  var onDiscovery: ((DiscoveredDevice) -> Void)?
  var started = false
  var scans = 0
  var stops = 0

  func start() { started = true }
  func scan() { scans += 1 }
  func stopScan() { stops += 1 }
}
