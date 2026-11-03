import Foundation

@MainActor
protocol BluetoothTransport: AnyObject {
  var onAvailability: ((BluetoothAvailability) -> Void)? { get set }
  var onDiscovery: ((DiscoveredDevice) -> Void)? { get set }
  var onConnect: ((UUID) -> Void)? { get set }
  var onDisconnect: ((UUID) -> Void)? { get set }
  var onConnectFailure: ((UUID) -> Void)? { get set }
  var onBatteryLevel: ((UUID, Data) -> Void)? { get set }
  var onHeartRateMeasurement: ((UUID, Data) -> Void)? { get set }
  var onCyclingMeasurement: ((UUID, CyclingCharacteristic, Data) -> Void)? { get set }
  var onTrainerControlReady: ((UUID) -> Void)? { get set }
  var onTrainerValue: ((UUID, TrainerCharacteristic, Data) -> Void)? { get set }
  func start()
  func scanAllDevices()
  func stopScan()
  func connectWhenInRange(_ id: UUID)
  func disconnect(_ id: UUID)
  func writeTrainerControl(_ data: Data, to id: UUID)
}
