import Foundation
import Testing

@testable import RideBluetooth

@MainActor
struct BluetoothDevicesTests {
  @Test func waitsForBluetoothBeforeScanning() {
    let transport = FakeTransport()
    let devices = BluetoothDevices(transport: transport, defaults: freshDefaults())
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
    let devices = BluetoothDevices(transport: transport, defaults: freshDefaults())
    transport.onAvailability?(state)
    devices.startScanning()
    #expect(devices.availability == state)
    #expect(!devices.isScanning)
    #expect(transport.scans == 0)
  }

  @Test func pairingConnectsAndRemembersTheDevice() {
    let defaults = freshDefaults()
    let (devices, transport) = scanningDevices(defaults: defaults)
    let trainer = DiscoveredDevice(id: UUID(), name: "KICKR CORE", services: [.trainer, .power])
    transport.onDiscovery?(trainer)
    devices.pair(trainer)
    #expect(transport.connects == [trainer.id])
    #expect(devices.connectionState(of: trainer.id) == .connecting)
    #expect(devices.fitnessDevices.isEmpty)
    transport.onConnect?(trainer.id)
    #expect(devices.connectionState(of: trainer.id) == .connected)

    // The next launch reconnects without scanning.
    let relaunched = FakeTransport()
    let restored = BluetoothDevices(transport: relaunched, defaults: defaults)
    #expect(restored.paired == [trainer])
    restored.connectPaired()
    #expect(relaunched.started)
    relaunched.onAvailability?(.ready)
    #expect(relaunched.connects == [trainer.id])
    #expect(relaunched.scans == 0)
  }

  @Test func doesNotStartBluetoothWithNothingPaired() {
    let transport = FakeTransport()
    let devices = BluetoothDevices(transport: transport, defaults: freshDefaults())
    devices.connectPaired()
    #expect(!transport.started)
  }

  @Test func pairingADeviceReplacesThePairedOneOfTheSameKind() {
    let (devices, transport) = scanningDevices()
    let old = DiscoveredDevice(id: UUID(), name: "Old strap", services: [.heartRate])
    let new = DiscoveredDevice(id: UUID(), name: "Polar H10", services: [.heartRate])
    let trainer = DiscoveredDevice(id: UUID(), name: "KICKR CORE", services: [.trainer])
    devices.pair(old)
    devices.pair(trainer)
    devices.pair(new)
    #expect(devices.paired == [trainer, new])
    #expect(transport.disconnects == [old.id])
    #expect(devices.paired(.heartRate) == new)
  }

  @Test func reconnectsAPairedDeviceThatDrops() {
    let (devices, transport) = scanningDevices()
    let strap = DiscoveredDevice(id: UUID(), name: "Polar H10", services: [.heartRate])
    devices.pair(strap)
    transport.onConnect?(strap.id)
    transport.onBattery?(strap.id, 78)
    #expect(devices.batteryLevel(of: strap.id) == 78)
    transport.onDisconnect?(strap.id)
    #expect(devices.connectionState(of: strap.id) == .connecting)
    #expect(devices.batteryLevel(of: strap.id) == nil)
    #expect(transport.connects == [strap.id, strap.id])
  }

  @Test func aFailedConnectionWaitsForTheRider() {
    let (devices, transport) = scanningDevices()
    let strap = DiscoveredDevice(id: UUID(), name: "Polar H10", services: [.heartRate])
    devices.pair(strap)
    transport.onConnectFailure?(strap.id)
    #expect(devices.connectionState(of: strap.id) == .disconnected)
    #expect(transport.connects.count == 1)
    devices.reconnect(strap.id)
    #expect(transport.connects.count == 2)
  }

  @Test func forgettingDisconnectsAndIgnoresLateCallbacks() {
    let (devices, transport) = scanningDevices()
    let strap = DiscoveredDevice(id: UUID(), name: "Polar H10", services: [.heartRate])
    devices.pair(strap)
    devices.forget(strap.id)
    #expect(devices.paired.isEmpty)
    #expect(transport.disconnects == [strap.id])
    transport.onConnect?(strap.id)
    #expect(devices.connectionState(of: strap.id) == .disconnected)
    #expect(transport.disconnects == [strap.id, strap.id])
  }

  @Test func prefersADedicatedSensorAsTheSourceOfAReading() {
    let (devices, transport) = scanningDevices()
    let trainer = DiscoveredDevice(id: UUID(), name: "KICKR CORE", services: [.trainer])
    let meter = DiscoveredDevice(id: UUID(), name: "Assioma", services: [.power])
    devices.pair(trainer)
    devices.pair(meter)
    transport.onConnect?(trainer.id)
    #expect(devices.source(of: .power) == trainer)
    #expect(devices.source(of: .cadence) == trainer)
    #expect(devices.source(of: .heartRate) == nil)
    transport.onConnect?(meter.id)
    #expect(devices.source(of: .power) == meter)
  }

  @Test func bluetoothGoingOffDropsConnectionsAndReconnectsWhenBack() {
    let (devices, transport) = scanningDevices()
    let strap = DiscoveredDevice(id: UUID(), name: "Polar H10", services: [.heartRate])
    devices.pair(strap)
    transport.onConnect?(strap.id)
    transport.onAvailability?(.poweredOff)
    #expect(devices.connectionState(of: strap.id) == .disconnected)
    transport.onAvailability?(.ready)
    #expect(devices.connectionState(of: strap.id) == .connecting)
    #expect(transport.connects == [strap.id, strap.id])
  }

  private func scanningDevices(
    defaults: UserDefaults = freshDefaults()
  ) -> (BluetoothDevices, FakeTransport) {
    let transport = FakeTransport()
    let devices = BluetoothDevices(transport: transport, defaults: defaults)
    transport.onAvailability?(.ready)
    devices.startScanning()
    return (devices, transport)
  }
}

/// Settings of their own, so tests neither see nor leave paired devices.
private func freshDefaults() -> UserDefaults {
  let suite = "RideBluetoothTests.\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: suite)!
  defaults.removePersistentDomain(forName: suite)
  return defaults
}

@MainActor
private final class FakeTransport: BluetoothTransport {
  var onAvailability: ((BluetoothAvailability) -> Void)?
  var onDiscovery: ((DiscoveredDevice) -> Void)?
  var onConnect: ((UUID) -> Void)?
  var onDisconnect: ((UUID) -> Void)?
  var onConnectFailure: ((UUID) -> Void)?
  var onBattery: ((UUID, Int) -> Void)?
  var started = false
  var scans = 0
  var stops = 0
  var connects: [UUID] = []
  var disconnects: [UUID] = []

  func start() { started = true }
  func scan() { scans += 1 }
  func stopScan() { stops += 1 }
  func connect(_ id: UUID) { connects.append(id) }
  func disconnect(_ id: UUID) { disconnects.append(id) }
}
