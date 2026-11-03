import Foundation

@testable import RideBluetooth

final class CyclingTestTransport: BluetoothTransport {
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

  func start() { onAvailability?(.ready) }
  func scanAllDevices() {}
  func stopScan() {}
  func connectWhenInRange(_ id: UUID) {}
  func disconnect(_ id: UUID) {}
  func writeTrainerControl(_ data: Data, to id: UUID) { trainerWrites.append(data) }
}
