import Foundation

@testable import RideBluetooth

@MainActor
final class FakeTransport: BluetoothTransport {
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
