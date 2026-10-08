import Foundation
import Testing

@testable import RideBluetooth

@MainActor
struct HeartRateSensorTests {
  let defaults = UserDefaults(suiteName: "HeartRateSensorTests.\(UUID())")!
  let transport = FakeHeartRateTransport()
  let strap = DiscoveredDevice(id: UUID(), name: "Polar H10", services: [.heartRate])

  @Test func doesNotStartBluetoothWithoutAPairedSensor() {
    _ = HeartRateSensor(transport: transport, defaults: defaults)
    #expect(!transport.started)
  }

  @Test func pairingConnectsOnceBluetoothIsReady() {
    let sensor = HeartRateSensor(transport: transport, defaults: defaults)
    sensor.pair(strap)
    #expect(transport.started)
    #expect(sensor.paired == PairedSensor(id: strap.id, name: "Polar H10"))
    #expect(sensor.connection == .waitingForBluetooth)
    #expect(transport.connects.isEmpty)
    transport.onAvailability?(.ready)
    #expect(sensor.connection == .connecting)
    #expect(transport.connects == [strap.id])
  }

  @Test func publishesLiveHeartRateWhileConnected() {
    let sensor = connectedSensor()
    transport.onMeasurement?(strap.id, .init(beatsPerMinute: 128))
    #expect(sensor.heartRate == 128)
    transport.onMeasurement?(strap.id, .init(beatsPerMinute: 131))
    #expect(sensor.heartRate == 131)
    transport.onMeasurement?(strap.id, .init(beatsPerMinute: 131, hasContact: false))
    #expect(sensor.heartRate == nil)
  }

  @Test func passesOnEachReading() {
    let sensor = connectedSensor()
    var readings: [Int] = []
    sensor.onReading = { readings.append($0) }
    transport.onMeasurement?(strap.id, .init(beatsPerMinute: 128))
    transport.onMeasurement?(strap.id, .init(beatsPerMinute: 128, hasContact: false))
    transport.onMeasurement?(UUID(), .init(beatsPerMinute: 90))
    transport.onMeasurement?(strap.id, .init(beatsPerMinute: 130))
    #expect(readings == [128, 130])
  }

  @Test func ignoresReadingsFromOtherSensors() {
    let sensor = connectedSensor()
    transport.onMeasurement?(UUID(), .init(beatsPerMinute: 90))
    #expect(sensor.heartRate == nil)
  }

  @Test func reconnectsWhenTheSensorDropsOut() {
    let sensor = connectedSensor()
    transport.onMeasurement?(strap.id, .init(beatsPerMinute: 128))
    transport.onDisconnect?(strap.id)
    #expect(sensor.heartRate == nil)
    #expect(sensor.connection == .connecting)
    #expect(transport.connects == [strap.id, strap.id])
  }

  @Test func waitsForTheRiderAfterAFailedConnection() {
    let sensor = connectedSensor()
    transport.onFailure?(strap.id)
    #expect(sensor.connection == .failed)
    #expect(transport.connects.count == 1)
    sensor.reconnect()
    #expect(sensor.connection == .connecting)
    #expect(transport.connects.count == 2)
  }

  @Test func reconnectsWhenBluetoothComesBack() {
    let sensor = connectedSensor()
    transport.onMeasurement?(strap.id, .init(beatsPerMinute: 128))
    transport.onAvailability?(.poweredOff)
    #expect(sensor.connection == .waitingForBluetooth)
    #expect(sensor.heartRate == nil)
    transport.onAvailability?(.ready)
    #expect(sensor.connection == .connecting)
    #expect(transport.connects.count == 2)
  }

  @Test func remembersThePairedSensorAcrossLaunches() {
    _ = connectedSensor()
    let relaunched = FakeHeartRateTransport()
    let sensor = HeartRateSensor(transport: relaunched, defaults: defaults)
    #expect(sensor.paired?.id == strap.id)
    #expect(relaunched.started)
    relaunched.onAvailability?(.ready)
    #expect(relaunched.connects == [strap.id])
  }

  @Test func pairingAnotherSensorReplacesTheFirst() {
    let sensor = connectedSensor()
    let other = DiscoveredDevice(id: UUID(), name: "Wahoo TICKR", services: [.heartRate])
    sensor.pair(other)
    #expect(transport.disconnects == [strap.id])
    #expect(transport.connects.last == other.id)
    transport.onDisconnect?(strap.id)
    #expect(transport.connects.last == other.id)
    #expect(sensor.paired?.name == "Wahoo TICKR")
  }

  @Test func forgettingDisconnectsAndStaysForgotten() {
    let sensor = connectedSensor()
    sensor.forget()
    #expect(sensor.paired == nil)
    #expect(transport.disconnects == [strap.id])
    transport.onMeasurement?(strap.id, .init(beatsPerMinute: 128))
    transport.onDisconnect?(strap.id)
    #expect(sensor.heartRate == nil)
    #expect(transport.connects.count == 1)
    #expect(HeartRateSensor(transport: FakeHeartRateTransport(), defaults: defaults).paired == nil)
  }

  private func connectedSensor() -> HeartRateSensor {
    let sensor = HeartRateSensor(transport: transport, defaults: defaults)
    transport.onAvailability?(.ready)
    sensor.pair(strap)
    transport.onConnect?(strap.id)
    return sensor
  }
}

@MainActor
final class FakeHeartRateTransport: HeartRateTransport {
  var onAvailability: ((BluetoothAvailability) -> Void)?
  var onConnect: ((UUID) -> Void)?
  var onDisconnect: ((UUID) -> Void)?
  var onFailure: ((UUID) -> Void)?
  var onMeasurement: ((UUID, HeartRateMeasurement) -> Void)?
  var started = false
  var connects: [UUID] = []
  var disconnects: [UUID] = []

  func start() { started = true }
  func connect(_ id: UUID) { connects.append(id) }
  func disconnect(_ id: UUID) { disconnects.append(id) }
}
