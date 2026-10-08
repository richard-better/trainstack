import CoreBluetooth
import Foundation

@MainActor
final class CoreBluetoothTransport: NSObject, BluetoothTransport {
  var onAvailability: ((BluetoothAvailability) -> Void)?
  var onDiscovery: ((DiscoveredDevice) -> Void)?
  var onConnect: ((UUID) -> Void)?
  var onDisconnect: ((UUID) -> Void)?
  var onConnectFailure: ((UUID) -> Void)?
  var onBattery: ((UUID, Int) -> Void)?
  var onHeartRate: ((UUID, HeartRateMeasurement) -> Void)?
  private var central: CBCentralManager?
  /// The peripherals connected or being connected to. CoreBluetooth drops a connection when
  /// nothing holds its peripheral.
  private var peripherals: [UUID: CBPeripheral] = [:]

  func start() {
    if central == nil {
      // CoreBluetooth delivers delegate callbacks on the main queue.
      central = CBCentralManager(delegate: self, queue: .main)
    }
  }

  // Scans unfiltered so the Devices pane can count the non-fitness devices it hides.
  func scan() {
    guard let central, central.state == .poweredOn else { return }
    central.scanForPeripherals(withServices: nil)
  }

  func stopScan() {
    guard let central, central.state == .poweredOn else { return }
    central.stopScan()
  }

  func connect(_ id: UUID) {
    guard let central, central.state == .poweredOn else { return }
    guard
      let peripheral = peripherals[id]
        ?? central.retrievePeripherals(withIdentifiers: [id]).first
    else {
      onConnectFailure?(id)
      return
    }
    peripherals[id] = peripheral
    peripheral.delegate = self
    central.connect(peripheral)
  }

  func disconnect(_ id: UUID) {
    guard let peripheral = peripherals.removeValue(forKey: id) else { return }
    central?.cancelPeripheralConnection(peripheral)
  }
}

extension CoreBluetoothTransport: @preconcurrency CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    let availability = BluetoothAvailability(central.state)
    // Peripherals are invalid once Bluetooth goes down, and must be retrieved again.
    if availability != .ready { peripherals.removeAll() }
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
    peripheral.discoverServices([GATT.battery, GATT.heartRate])
  }

  func centralManager(
    _ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: (any Error)?
  ) {
    guard peripherals.removeValue(forKey: peripheral.identifier) != nil else { return }
    onConnectFailure?(peripheral.identifier)
  }

  func centralManager(
    _ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
    error: (any Error)?
  ) {
    // A disconnect that was asked for has already let the peripheral go.
    guard peripherals[peripheral.identifier] != nil else { return }
    onDisconnect?(peripheral.identifier)
  }
}

extension CoreBluetoothTransport: @preconcurrency CBPeripheralDelegate {
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: (any Error)?) {
    for service in peripheral.services ?? [] {
      switch service.uuid {
      case GATT.battery: peripheral.discoverCharacteristics([GATT.batteryLevel], for: service)
      case GATT.heartRate:
        peripheral.discoverCharacteristics([GATT.heartRateMeasurement], for: service)
      default: break
      }
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService,
    error: (any Error)?
  ) {
    for characteristic in service.characteristics ?? [] {
      switch characteristic.uuid {
      case GATT.batteryLevel:
        peripheral.readValue(for: characteristic)
        if characteristic.properties.contains(.notify) {
          peripheral.setNotifyValue(true, for: characteristic)
        }
      case GATT.heartRateMeasurement:
        peripheral.setNotifyValue(true, for: characteristic)
      default: break
      }
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic,
    error: (any Error)?
  ) {
    guard let value = characteristic.value else { return }
    switch characteristic.uuid {
    case GATT.batteryLevel:
      if let level = value.first { onBattery?(peripheral.identifier, min(Int(level), 100)) }
    case GATT.heartRateMeasurement:
      if let measurement = HeartRateMeasurement(value) {
        onHeartRate?(peripheral.identifier, measurement)
      }
    default: break
    }
  }
}
