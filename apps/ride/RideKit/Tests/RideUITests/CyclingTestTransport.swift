import Foundation

@testable import RideBluetooth

/// Delivers real characteristic payloads to the ride without requiring sensor hardware.
final class CyclingTestTransport: BluetoothTransport {
  var onAvailability: ((BluetoothAvailability) -> Void)?
  var onDiscovery: ((DiscoveredDevice) -> Void)?
  var onConnect: ((UUID) -> Void)?
  var onDisconnect: ((UUID) -> Void)?
  var onConnectFailure: ((UUID) -> Void)?
  var onBattery: ((UUID, Int) -> Void)?
  var onHeartRate: ((UUID, HeartRateMeasurement) -> Void)?
  var onCyclingMeasurement: ((UUID, CyclingCharacteristic, Data) -> Void)?
  var onTrainerControlReady: ((UUID) -> Void)?
  var onTrainerValue: ((UUID, TrainerCharacteristic, Data) -> Void)?
  var trainerWrites: [Data] = []

  func start() { onAvailability?(.ready) }
  func scan() {}
  func stopScan() {}
  func connect(_ id: UUID) {}
  func disconnect(_ id: UUID) {}
  func writeTrainerControl(_ data: Data, to id: UUID) { trainerWrites.append(data) }
}
