import Foundation
import Testing

@testable import RideBluetooth

@MainActor
struct BluetoothDevicesTests {
  @Test func pairingStartsBluetoothWithoutScanning() {
    let transport = FakeTransport()
    let devices = BluetoothDevices(transport: transport, defaults: isolatedDefaults())
    let trainer = DiscoveredDevice(id: UUID(), services: [.trainer])
    devices.pair(trainer)
    #expect(transport.started)
    #expect(transport.connects.isEmpty)
    transport.onAvailability?(.ready)
    #expect(transport.connects == [trainer.id])
    #expect(transport.scans == 0)
  }

  @Test func waitsForBluetoothBeforeScanning() {
    let transport = FakeTransport()
    let devices = BluetoothDevices(transport: transport, defaults: isolatedDefaults())
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
    let devices = BluetoothDevices(transport: transport, defaults: isolatedDefaults())
    transport.onAvailability?(state)
    devices.startScanning()
    #expect(devices.availability == state)
    #expect(!devices.isScanning)
    #expect(transport.scans == 0)
  }

  @Test func pairingConnectsAndTheNextLaunchReconnectsWithoutScanning() {
    let defaults = isolatedDefaults()
    let (devices, transport) = scanningDevices(defaults: defaults)
    let trainer = DiscoveredDevice(id: UUID(), name: "KICKR CORE", services: [.trainer, .power])
    transport.onDiscovery?(trainer)
    devices.pair(trainer)
    #expect(transport.connects == [trainer.id])
    #expect(devices.connectionState(of: trainer.id) == .connecting)
    #expect(devices.fitnessDevices.isEmpty)
    transport.onConnect?(trainer.id)
    #expect(devices.connectionState(of: trainer.id) == .connected)
    let relaunched = FakeTransport()
    let restored = BluetoothDevices(transport: relaunched, defaults: defaults)
    #expect(restored.paired == [trainer])
    restored.connectPaired()
    #expect(relaunched.started)
    relaunched.onAvailability?(.ready)
    #expect(relaunched.connects == [trainer.id])
    #expect(relaunched.scans == 0)
  }

  @Test func doesNotStartBluetoothOrAskForItsPermissionWithNothingPaired() {
    let transport = FakeTransport()
    let devices = BluetoothDevices(transport: transport, defaults: isolatedDefaults())
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
    transport.onBatteryLevel?(strap.id, Data([78]))
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

  @Test func listsEverySensorForAMetricWhetherOrNotConnected() {
    let (devices, transport) = scanningDevices()
    let trainer = DiscoveredDevice(id: UUID(), name: "KICKR CORE", services: [.trainer])
    let meter = DiscoveredDevice(id: UUID(), name: "Assioma", services: [.power])
    devices.pair(trainer)
    devices.pair(meter)
    transport.onConnect?(trainer.id)
    #expect(devices.sensors(of: .power) == [meter, trainer])
    #expect(devices.sensors(of: .heartRate).isEmpty)
  }

  @Test func countsOnlyTheConnectedSensorsForAMetric() {
    let (devices, transport) = scanningDevices()
    let trainer = DiscoveredDevice(id: UUID(), name: "KICKR CORE", services: [.trainer])
    let meter = DiscoveredDevice(id: UUID(), name: "Assioma", services: [.power])
    devices.pair(trainer)
    devices.pair(meter)
    #expect(devices.connectedSensors(of: .power).isEmpty)
    transport.onConnect?(meter.id)
    #expect(devices.connectedSensors(of: .power) == [meter])
    transport.onConnect?(trainer.id)
    #expect(devices.connectedSensors(of: .power) == [meter, trainer])
    #expect(devices.connectedSensors(of: .heartRate).isEmpty)
    transport.onDisconnect?(trainer.id)
    #expect(devices.connectedSensors(of: .power) == [meter])
  }

  @Test func theRidersPickIsUsedWhileItIsConnectedAndRemembered() {
    let defaults = isolatedDefaults()
    let transport = FakeTransport()
    let devices = BluetoothDevices(transport: transport, defaults: defaults)
    transport.onAvailability?(.ready)
    let trainer = DiscoveredDevice(id: UUID(), name: "KICKR CORE", services: [.trainer])
    let meter = DiscoveredDevice(id: UUID(), name: "Assioma", services: [.power])
    devices.pair(trainer)
    devices.pair(meter)
    transport.onConnect?(trainer.id)
    transport.onConnect?(meter.id)
    devices.select(trainer, for: .power)
    #expect(devices.source(of: .power) == trainer)

    transport.onDisconnect?(trainer.id)
    #expect(devices.source(of: .power) == meter)
    transport.onConnect?(trainer.id)
    #expect(devices.source(of: .power) == trainer)

    let relaunchTransport = FakeTransport()
    let relaunched = BluetoothDevices(transport: relaunchTransport, defaults: defaults)
    relaunchTransport.onAvailability?(.ready)
    relaunchTransport.onConnect?(meter.id)
    relaunchTransport.onConnect?(trainer.id)
    #expect(relaunched.source(of: .power) == trainer)
  }

  @Test func ignoresAPickThatIsNotASensorForTheMetric() {
    let (devices, transport) = scanningDevices()
    let trainer = DiscoveredDevice(id: UUID(), name: "KICKR CORE", services: [.trainer])
    let strap = DiscoveredDevice(id: UUID(), name: "Polar H10", services: [.heartRate])
    devices.pair(trainer)
    devices.pair(strap)
    transport.onConnect?(trainer.id)
    transport.onConnect?(strap.id)
    devices.select(strap, for: .power)
    devices.select(trainer, for: .heartRate)
    #expect(devices.source(of: .power) == trainer)
    #expect(devices.source(of: .heartRate) == strap)
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

  @Test func publishesTheConnectedStrapsHeartRate() {
    let (devices, transport) = scanningDevices()
    let strap = DiscoveredDevice(id: UUID(), name: "Polar H10", services: [.heartRate])
    devices.pair(strap)
    transport.onHeartRateMeasurement?(strap.id, HeartRateMeasurement(beatsPerMinute: 120).data)
    #expect(devices.heartRate == nil)
    transport.onConnect?(strap.id)
    transport.onHeartRateMeasurement?(strap.id, HeartRateMeasurement(beatsPerMinute: 128).data)
    #expect(devices.heartRate == 128)
    transport.onHeartRateMeasurement?(
      strap.id, HeartRateMeasurement(beatsPerMinute: 131, hasContact: false).data)
    #expect(devices.heartRate == nil)
  }

  @Test func ignoresAHeartRatePacketCutShort() {
    let (devices, transport) = scanningDevices()
    let strap = DiscoveredDevice(id: UUID(), services: [.heartRate])
    devices.pair(strap)
    transport.onConnect?(strap.id)
    transport.onHeartRateMeasurement?(strap.id, HeartRateMeasurement(beatsPerMinute: 128).data)
    transport.onHeartRateMeasurement?(strap.id, Data([0x01, 0x90]))
    #expect(devices.heartRate == 128)
  }

  @Test func capsTheBatteryLevelAtAHundred() {
    let (devices, transport) = scanningDevices()
    let strap = DiscoveredDevice(id: UUID(), services: [.heartRate])
    devices.pair(strap)
    transport.onConnect?(strap.id)
    transport.onBatteryLevel?(strap.id, Data([180]))
    #expect(devices.batteryLevel(of: strap.id) == 100)
    transport.onBatteryLevel?(strap.id, Data())
    #expect(devices.batteryLevel(of: strap.id) == 100)
  }

  @Test func expiresHeartRateWhenAConnectedSensorStopsReporting() {
    let (devices, transport) = scanningDevices()
    let strap = DiscoveredDevice(id: UUID(), services: [.heartRate])
    devices.pair(strap)
    transport.onConnect?(strap.id)
    let now = Date.now
    transport.onHeartRateMeasurement?(strap.id, HeartRateMeasurement(beatsPerMinute: 128).data)
    #expect(devices.reading(for: .heartRate, at: now) == 128)
    #expect(devices.reading(for: .heartRate, at: now.addingTimeInterval(6)) == nil)
  }

  @Test func keepsHeartRateFromAlternativeSensorsForThePicker() {
    let (devices, transport) = scanningDevices()
    let strap = DiscoveredDevice(id: UUID(), services: [.heartRate])
    let trainer = DiscoveredDevice(id: UUID(), services: [.trainer, .heartRate])
    devices.pair(strap)
    devices.pair(trainer)
    transport.onConnect?(strap.id)
    transport.onConnect?(trainer.id)
    transport.onHeartRateMeasurement?(strap.id, HeartRateMeasurement(beatsPerMinute: 128).data)
    transport.onHeartRateMeasurement?(trainer.id, HeartRateMeasurement(beatsPerMinute: 140).data)
    #expect(devices.heartRate == 128)
    #expect(devices.reading(for: .heartRate, from: trainer.id) == 140)
    devices.select(trainer, for: .heartRate)
    #expect(devices.heartRate == 140)
    transport.onHeartRateMeasurement?(
      trainer.id, HeartRateMeasurement(beatsPerMinute: 140, hasContact: false).data)
    #expect(devices.heartRate == nil)
    #expect(devices.reading(for: .heartRate, from: strap.id) == 128)
  }

  @Test func readsEachCyclingSensorAndSwitchesTheSelectedMetricImmediately() {
    let (devices, transport) = scanningDevices()
    let trainer = DiscoveredDevice(id: UUID(), name: "KICKR", services: [.trainer])
    let meter = DiscoveredDevice(id: UUID(), name: "Assioma", services: [.power])
    devices.pair(trainer)
    devices.pair(meter)
    transport.onConnect?(trainer.id)
    transport.onConnect?(meter.id)
    transport.onCyclingMeasurement?(trainer.id, .indoorBike, Data([0x45, 0, 180, 0, 200, 0]))
    transport.onCyclingMeasurement?(meter.id, .power, Data([0, 0, 210, 0]))
    #expect(devices.power == 210)
    #expect(devices.cadence == nil)
    #expect(devices.reading(for: .power, from: trainer.id) == 200)
    #expect(devices.reading(for: .cadence, from: trainer.id) == 90)
    devices.select(trainer, for: .power)
    devices.select(trainer, for: .cadence)
    #expect(devices.power == 200)
    #expect(devices.cadence == 90)
    transport.onDisconnect?(trainer.id)
    #expect(devices.power == 210)
    #expect(devices.reading(for: .power, from: trainer.id) == nil)
    transport.onConnect?(trainer.id)
    #expect(devices.power == nil)
    #expect(devices.cadence == nil)
    transport.onCyclingMeasurement?(trainer.id, .indoorBike, Data([0x45, 0, 0, 0, 0, 0]))
    #expect(devices.power == 0)
    #expect(devices.cadence == 0)
  }

  @Test func clearsCyclingReadingsWhenForgottenOrBluetoothGoesOff() {
    let (devices, transport) = scanningDevices()
    let trainer = DiscoveredDevice(id: UUID(), services: [.trainer])
    devices.pair(trainer)
    transport.onConnect?(trainer.id)
    transport.onCyclingMeasurement?(trainer.id, .indoorBike, Data([0x45, 0, 180, 0, 200, 0]))
    #expect(devices.power == 200)
    transport.onAvailability?(.poweredOff)
    transport.onAvailability?(.ready)
    transport.onConnect?(trainer.id)
    #expect(devices.power == nil)
    transport.onCyclingMeasurement?(trainer.id, .indoorBike, Data([0x45, 0, 180, 0, 200, 0]))
    devices.forget(trainer.id)
    transport.onCyclingMeasurement?(trainer.id, .indoorBike, Data([0x45, 0, 180, 0, 200, 0]))
    #expect(devices.power == nil)
    #expect(devices.reading(for: .cadence, from: trainer.id) == nil)
  }

  @Test func cyclingReadingsExpireAndUnpairedNotificationsAreIgnored() {
    let (devices, transport) = scanningDevices()
    let trainer = DiscoveredDevice(id: UUID(), services: [.trainer])
    let now = Date.now
    let packet = Data([0x45, 0, 180, 0, 200, 0])
    devices.pair(trainer)
    devices.receiveCycling(packet, from: trainer.id, characteristic: .indoorBike, at: now)
    #expect(devices.power == nil)
    transport.onConnect?(trainer.id)
    devices.receiveCycling(packet, from: trainer.id, characteristic: .indoorBike, at: now)
    #expect(devices.reading(for: .power, at: now) == 200)
    #expect(devices.reading(for: .power, at: now.addingTimeInterval(6)) == nil)
    devices.receiveCycling(packet, from: UUID(), characteristic: .indoorBike, at: now)
    #expect(devices.reading(for: .power, at: now) == 200)
  }

  @Test func remembersWhenEachConnectedDeviceWasLastHeardFrom() {
    let (devices, transport) = scanningDevices()
    let trainer = DiscoveredDevice(id: UUID(), services: [.trainer])
    let strap = DiscoveredDevice(id: UUID(), services: [.heartRate])
    devices.pair(trainer)
    devices.pair(strap)
    #expect(devices.lastHeard(from: trainer.id) == nil)
    let connected = Date.now
    transport.onConnect?(trainer.id)
    transport.onConnect?(strap.id)
    #expect(devices.lastHeard(from: trainer.id).map { $0 >= connected } == true)
    let later = connected.addingTimeInterval(30)
    devices.receiveCycling(
      Data([0x45, 0, 180, 0, 200, 0]), from: trainer.id, characteristic: .indoorBike, at: later)
    #expect(devices.lastHeard(from: trainer.id) == later)
    transport.onDisconnect?(trainer.id)
    #expect(devices.lastHeard(from: trainer.id) == nil)
    devices.forget(strap.id)
    #expect(devices.lastHeard(from: strap.id) == nil)
  }

  @Test func aStrapThatLostContactIsNotHeardFrom() {
    let (devices, transport) = scanningDevices()
    let strap = DiscoveredDevice(id: UUID(), services: [.heartRate])
    devices.pair(strap)
    transport.onConnect?(strap.id)
    let heard = devices.lastHeard(from: strap.id)
    transport.onHeartRateMeasurement?(
      strap.id, HeartRateMeasurement(beatsPerMinute: 128, hasContact: false).data)
    #expect(devices.lastHeard(from: strap.id) == heard)
  }

  @Test func reportsCyclingActivityForEachMeasurementFromAConnectedPairedSensor() {
    let (devices, transport) = scanningDevices()
    let trainer = DiscoveredDevice(id: UUID(), services: [.trainer])
    let packet = Data([0x45, 0, 180, 0, 200, 0])
    var activity = 0
    devices.onCyclingActivity = { activity += 1 }
    devices.pair(trainer)
    transport.onCyclingMeasurement?(trainer.id, .indoorBike, packet)
    #expect(activity == 0)
    transport.onConnect?(trainer.id)
    transport.onCyclingMeasurement?(trainer.id, .indoorBike, packet)
    transport.onCyclingMeasurement?(trainer.id, .indoorBike, packet)
    transport.onCyclingMeasurement?(UUID(), .indoorBike, packet)
    #expect(activity == 2)
  }

  @Test func readsSourcePicksSavedKeyedByMetricName() throws {
    let defaults = isolatedDefaults()
    let trainer = DiscoveredDevice(id: UUID(), services: [.trainer])
    let meter = DiscoveredDevice(id: UUID(), services: [.power])
    defaults.set(try JSONEncoder().encode([trainer, meter]), forKey: "bluetooth.paired")
    defaults.set(
      try JSONEncoder().encode(["power": trainer.id]), forKey: "bluetooth.sourcePicks")
    let transport = FakeTransport()
    let devices = BluetoothDevices(transport: transport, defaults: defaults)
    transport.onAvailability?(.ready)
    transport.onConnect?(trainer.id)
    transport.onConnect?(meter.id)
    #expect(devices.source(of: .power) == trainer)
  }

  @Test func passesOnEachHeartRateFromThePairedStrapOnly() {
    let (devices, transport) = scanningDevices()
    let strap = DiscoveredDevice(id: UUID(), name: "Polar H10", services: [.heartRate])
    devices.pair(strap)
    transport.onConnect?(strap.id)
    var readings: [Int] = []
    devices.onHeartRate = { readings.append($0) }
    transport.onHeartRateMeasurement?(strap.id, HeartRateMeasurement(beatsPerMinute: 128).data)
    transport.onHeartRateMeasurement?(
      strap.id, HeartRateMeasurement(beatsPerMinute: 128, hasContact: false).data)
    transport.onHeartRateMeasurement?(UUID(), HeartRateMeasurement(beatsPerMinute: 90).data)
    transport.onHeartRateMeasurement?(strap.id, HeartRateMeasurement(beatsPerMinute: 130).data)
    #expect(readings == [128, 130])
  }

  @Test func dropsTheHeartRateWhenTheStrapGoes() {
    let (devices, transport) = scanningDevices()
    let strap = DiscoveredDevice(id: UUID(), name: "Polar H10", services: [.heartRate])
    devices.pair(strap)
    transport.onConnect?(strap.id)
    transport.onHeartRateMeasurement?(strap.id, HeartRateMeasurement(beatsPerMinute: 128).data)
    transport.onDisconnect?(strap.id)
    #expect(devices.heartRate == nil)
    transport.onConnect?(strap.id)
    #expect(devices.heartRate == nil)
    transport.onHeartRateMeasurement?(strap.id, HeartRateMeasurement(beatsPerMinute: 128).data)
    devices.forget(strap.id)
    #expect(devices.heartRate == nil)
  }

  @Test func adoptsTheStrapPairedBeforeDevicesOfEachKind() throws {
    let defaults = isolatedDefaults()
    let id = UUID()
    defaults.set(
      try JSONEncoder().encode(["id": id.uuidString, "name": "Polar H10"]),
      forKey: "pairedHeartRateSensor")
    let devices = BluetoothDevices(transport: FakeTransport(), defaults: defaults)
    #expect(devices.paired == [.init(id: id, name: "Polar H10", services: [.heartRate])])
    #expect(defaults.data(forKey: "pairedHeartRateSensor") == nil)
    let relaunched = BluetoothDevices(transport: FakeTransport(), defaults: defaults)
    #expect(relaunched.paired == devices.paired)
  }

  @Test func controlsThePairedTrainerOnceItsControlPointIsReady() {
    let (devices, transport) = scanningDevices()
    let trainer = DiscoveredDevice(id: UUID(), name: "KICKR CORE", services: [.trainer])
    let strap = DiscoveredDevice(id: UUID(), name: "Polar H10", services: [.heartRate])
    devices.pair(trainer)
    devices.pair(strap)
    transport.onConnect?(trainer.id)
    transport.onConnect?(strap.id)
    devices.setTrainerTarget(.power(watts: 200))
    transport.onTrainerControlReady?(strap.id)
    #expect(transport.trainerWrites.isEmpty)
    transport.onTrainerControlReady?(trainer.id)
    #expect(transport.trainerWrites == [Data([0x00])])
    transport.onTrainerValue?(trainer.id, .controlPoint, Data([0x80, 0x00, 0x01]))
    transport.onTrainerValue?(trainer.id, .controlPoint, Data([0x80, 0x07, 0x01]))
    #expect(transport.trainerWrites.last == Data([0x05, 200, 0]))
    transport.onTrainerValue?(trainer.id, .controlPoint, Data([0x80, 0x05, 0x01]))
    devices.setTrainerTarget(.power(watts: 200))
    devices.setTrainerTarget(.power(watts: 220))
    #expect(transport.trainerWrites.count == 4)
    #expect(transport.trainerWrites.last == Data([0x05, 220, 0]))
  }

  @Test func takesControlAgainAfterTheTrainerReconnects() {
    let (devices, transport) = scanningDevices()
    let trainer = DiscoveredDevice(id: UUID(), name: "KICKR CORE", services: [.trainer])
    devices.pair(trainer)
    transport.onConnect?(trainer.id)
    devices.setTrainerTarget(.grade(percent: 2))
    transport.onTrainerControlReady?(trainer.id)
    transport.onTrainerValue?(trainer.id, .controlPoint, Data([0x80, 0x00, 0x01]))
    transport.onDisconnect?(trainer.id)
    devices.setTrainerTarget(.grade(percent: 3))
    #expect(transport.trainerWrites == [Data([0x00]), Data([0x07])])
    transport.onConnect?(trainer.id)
    transport.onTrainerControlReady?(trainer.id)
    #expect(transport.trainerWrites.last == Data([0x00]))
  }

  private func scanningDevices(
    defaults: UserDefaults = isolatedDefaults()
  ) -> (BluetoothDevices, FakeTransport) {
    let transport = FakeTransport()
    let devices = BluetoothDevices(transport: transport, defaults: defaults)
    transport.onAvailability?(.ready)
    devices.startScanning()
    return (devices, transport)
  }
}

private func isolatedDefaults() -> UserDefaults {
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
  var onBatteryLevel: ((UUID, Data) -> Void)?
  var onHeartRateMeasurement: ((UUID, Data) -> Void)?
  var onCyclingMeasurement: ((UUID, CyclingCharacteristic, Data) -> Void)?
  var onTrainerControlReady: ((UUID) -> Void)?
  var onTrainerValue: ((UUID, TrainerCharacteristic, Data) -> Void)?
  var trainerWrites: [Data] = []
  var started = false
  var scans = 0
  var stops = 0
  var connects: [UUID] = []
  var disconnects: [UUID] = []

  func start() { started = true }
  func scanAllDevices() { scans += 1 }
  func stopScan() { stops += 1 }
  func connectWhenInRange(_ id: UUID) { connects.append(id) }
  func disconnect(_ id: UUID) { disconnects.append(id) }
  func writeTrainerControl(_ data: Data, to id: UUID) { trainerWrites.append(data) }
}
