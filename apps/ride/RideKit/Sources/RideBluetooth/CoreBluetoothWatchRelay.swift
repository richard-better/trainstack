import CoreBluetooth
import Foundation

@MainActor
final class CoreBluetoothWatchRelay: NSObject, WatchRelayTransport {
  var onMeasurement: ((UUID, HeartRateMeasurement) -> Void)?
  private var central: CBCentralManager?
  private var wanted = false
  private var claimsRide = false
  /// Relays found, kept so they reconnect when they come back in range. CoreBluetooth cancels a
  /// connection whose peripheral is released.
  private var peripherals: [UUID: CBPeripheral] = [:]

  func start(claimingRide: Bool) {
    wanted = true
    claimsRide = claimingRide
    if let central {
      scan(central)
    } else {
      // CoreBluetooth delivers delegate callbacks on the main queue.
      central = CBCentralManager(delegate: self, queue: .main)
    }
  }

  func stop() {
    wanted = false
    guard let central, central.state == .poweredOn else { return }
    central.stopScan()
    for peripheral in peripherals.values { central.cancelPeripheralConnection(peripheral) }
    peripherals.removeAll()
  }

  private func scan(_ central: CBCentralManager) {
    guard wanted, central.state == .poweredOn else { return }
    // A relaying iPhone in the background only advertises its services to scans that ask for
    // them by name.
    central.scanForPeripherals(withServices: [HeartRateRelay.service])
  }
}

extension CoreBluetoothWatchRelay: @preconcurrency CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    // Turning Bluetooth off ends every connection without a callback for each.
    if central.state == .poweredOn { scan(central) } else { peripherals.removeAll() }
  }

  func centralManager(
    _ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any], rssi: NSNumber
  ) {
    guard wanted, peripherals[peripheral.identifier] == nil else { return }
    peripherals[peripheral.identifier] = peripheral
    peripheral.delegate = self
    central.connect(peripheral)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.discoverServices([GATT.heartRate, HeartRateRelay.service])
  }

  func centralManager(
    _ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: (any Error)?
  ) {
    guard wanted, peripherals[peripheral.identifier] != nil else { return }
    central.connect(peripheral)
  }

  func centralManager(
    _ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
    error: (any Error)?
  ) {
    // Connecting has no time limit, so the relay comes back as soon as it is in range again.
    guard wanted, peripherals[peripheral.identifier] != nil else { return }
    central.connect(peripheral)
  }
}

extension CoreBluetoothWatchRelay: @preconcurrency CBPeripheralDelegate {
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: (any Error)?) {
    for service in peripheral.services ?? [] {
      if service.uuid == GATT.heartRate {
        peripheral.discoverCharacteristics([GATT.heartRateMeasurement], for: service)
      } else if service.uuid == HeartRateRelay.service, claimsRide {
        peripheral.discoverCharacteristics([HeartRateRelay.rideRecorded], for: service)
      }
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService,
    error: (any Error)?
  ) {
    for characteristic in service.characteristics ?? [] {
      if characteristic.uuid == GATT.heartRateMeasurement {
        peripheral.setNotifyValue(true, for: characteristic)
      } else if characteristic.uuid == HeartRateRelay.rideRecorded {
        peripheral.writeValue(Data([1]), for: characteristic, type: .withResponse)
      }
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic,
    error: (any Error)?
  ) {
    guard characteristic.uuid == GATT.heartRateMeasurement,
      let data = characteristic.value, let measurement = HeartRateMeasurement(data)
    else { return }
    onMeasurement?(peripheral.identifier, measurement)
  }
}
