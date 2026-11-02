import CoreBluetooth
import Foundation

@MainActor
final class CoreBluetoothTransport: NSObject, BluetoothTransport {
  var onAvailability: ((BluetoothAvailability) -> Void)?
  var onDiscovery: ((DiscoveredDevice) -> Void)?
  var onConnect: ((UUID) -> Void)?
  var onDisconnect: ((UUID) -> Void)?
  var onConnectFailure: ((UUID) -> Void)?
  var onBatteryPercent: ((UUID, Int) -> Void)?
  var onHeartRate: ((UUID, HeartRateMeasurement) -> Void)?
  var onCyclingMeasurement: ((UUID, CyclingCharacteristic, Data) -> Void)?
  var onTrainerControlReady: ((UUID) -> Void)?
  var onTrainerValue: ((UUID, TrainerCharacteristic, Data) -> Void)?
  private var central: CBCentralManager?
  private var heldPeripherals: [UUID: CBPeripheral] = [:]

  func start() {
    if central == nil {
      central = CBCentralManager(delegate: self, queue: .main)
    }
  }

  func scanAllDevices() {
    guard let central, central.state == .poweredOn else { return }
    central.scanForPeripherals(withServices: nil)
  }

  func stopScan() {
    guard let central, central.state == .poweredOn else { return }
    central.stopScan()
  }

  func connectWhenInRange(_ id: UUID) {
    guard let central, central.state == .poweredOn else { return }
    guard
      let peripheral = heldPeripherals[id]
        ?? central.retrievePeripherals(withIdentifiers: [id]).first
    else {
      onConnectFailure?(id)
      return
    }
    heldPeripherals[id] = peripheral
    peripheral.delegate = self
    central.connect(peripheral)
  }

  func disconnect(_ id: UUID) {
    guard let peripheral = heldPeripherals.removeValue(forKey: id) else { return }
    central?.cancelPeripheralConnection(peripheral)
  }

  func writeTrainerControl(_ data: Data, to id: UUID) {
    guard let peripheral = heldPeripherals[id], peripheral.state == .connected,
      let controlPoint = peripheral.services?.first(where: { $0.uuid == GATT.trainer })?
        .characteristics?.first(where: { $0.uuid == GATT.fitnessMachineControlPoint })
    else { return }
    peripheral.writeValue(data, for: controlPoint, type: .withResponse)
  }
}

extension CoreBluetoothTransport: @preconcurrency CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    let availability = BluetoothAvailability(central.state)
    if availability != .ready { heldPeripherals.removeAll() }
    onAvailability?(availability)
  }

  func centralManager(
    _ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any], rssi: NSNumber
  ) {
    let uuids =
      (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? [])
      + (advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID] ?? [])
    onDiscovery?(
      DiscoveredDevice(
        id: peripheral.identifier,
        name: advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? peripheral.name,
        services: Set(uuids.compactMap { FitnessService(rawValue: $0.uuidString) })
      ))
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    onConnect?(peripheral.identifier)
    peripheral.discoverServices([
      GATT.battery, GATT.heartRate, GATT.power, GATT.speedAndCadence, GATT.trainer,
    ])
  }

  func centralManager(
    _ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: (any Error)?
  ) {
    guard heldPeripherals.removeValue(forKey: peripheral.identifier) != nil else { return }
    onConnectFailure?(peripheral.identifier)
  }

  func centralManager(
    _ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
    error: (any Error)?
  ) {
    let wasAskedToDisconnect = heldPeripherals[peripheral.identifier] == nil
    guard !wasAskedToDisconnect else { return }
    onDisconnect?(peripheral.identifier)
  }
}

extension CoreBluetoothTransport: @preconcurrency CBPeripheralDelegate {
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: (any Error)?) {
    guard error == nil else { return }
    for service in peripheral.services ?? [] {
      switch service.uuid {
      case GATT.battery: peripheral.discoverCharacteristics([GATT.batteryLevel], for: service)
      case GATT.heartRate:
        peripheral.discoverCharacteristics([GATT.heartRateMeasurement], for: service)
      case GATT.power:
        peripheral.discoverCharacteristics([GATT.cyclingPowerMeasurement], for: service)
      case GATT.speedAndCadence:
        peripheral.discoverCharacteristics([GATT.cyclingSpeedCadenceMeasurement], for: service)
      case GATT.trainer:
        peripheral.discoverCharacteristics(
          [
            GATT.indoorBikeData, GATT.fitnessMachineControlPoint, GATT.fitnessMachineStatus,
            GATT.supportedResistanceLevelRange, GATT.supportedPowerRange,
          ], for: service)
      default: break
      }
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService,
    error: (any Error)?
  ) {
    guard error == nil else { return }
    for characteristic in service.characteristics ?? [] {
      switch characteristic.uuid {
      case GATT.batteryLevel:
        peripheral.readValue(for: characteristic)
        if characteristic.properties.contains(.notify) {
          peripheral.setNotifyValue(true, for: characteristic)
        }
      case GATT.heartRateMeasurement, GATT.cyclingPowerMeasurement,
        GATT.cyclingSpeedCadenceMeasurement, GATT.indoorBikeData, GATT.fitnessMachineStatus,
        GATT.fitnessMachineControlPoint:
        peripheral.setNotifyValue(true, for: characteristic)
      case GATT.supportedResistanceLevelRange, GATT.supportedPowerRange:
        peripheral.readValue(for: characteristic)
      default: break
      }
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic,
    error: (any Error)?
  ) {
    guard error == nil, let value = characteristic.value,
      heldPeripherals[peripheral.identifier] === peripheral, peripheral.state == .connected
    else { return }
    switch characteristic.uuid {
    case GATT.batteryLevel:
      if let level = value.first { onBatteryPercent?(peripheral.identifier, min(Int(level), 100)) }
    case GATT.heartRateMeasurement:
      if let measurement = HeartRateMeasurement(value) {
        onHeartRate?(peripheral.identifier, measurement)
      }
    default:
      if let cycling = CyclingCharacteristic(rawValue: characteristic.uuid.uuidString) {
        onCyclingMeasurement?(peripheral.identifier, cycling, value)
      } else if let trainer = TrainerCharacteristic(rawValue: characteristic.uuid.uuidString) {
        onTrainerValue?(peripheral.identifier, trainer, value)
      }
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic,
    error: (any Error)?
  ) {
    let controlPointIndicates =
      characteristic.uuid == GATT.fitnessMachineControlPoint && characteristic.isNotifying
    guard error == nil, controlPointIndicates, heldPeripherals[peripheral.identifier] === peripheral
    else { return }
    onTrainerControlReady?(peripheral.identifier)
  }
}
