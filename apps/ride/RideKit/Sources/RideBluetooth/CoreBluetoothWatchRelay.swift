import CoreBluetooth
import Foundation

@MainActor
final class CoreBluetoothWatchRelay: NSObject, WatchRelayTransport {
  var onMeasurement: ((UUID, HeartRateMeasurement) -> Void)?
  private var central: CBCentralManager?
  private var wanted = false
  private var claim: RideClaim?
  private var heldRelays: [UUID: CBPeripheral] = [:]

  func start(claim: RideClaim?) {
    wanted = true
    self.claim = claim
    if let central {
      scan(central)
    } else {
      central = CBCentralManager(delegate: self, queue: .main)
    }
  }

  func stop() {
    wanted = false
    guard let central, central.state == .poweredOn else { return }
    central.stopScan()
    for peripheral in heldRelays.values { central.cancelPeripheralConnection(peripheral) }
    heldRelays.removeAll()
  }

  private func scan(_ central: CBCentralManager) {
    guard wanted, central.state == .poweredOn else { return }
    central.scanForPeripherals(withServices: [HeartRateRelay.service])
  }
}

extension CoreBluetoothWatchRelay: @preconcurrency CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if central.state == .poweredOn { scan(central) } else { heldRelays.removeAll() }
  }

  func centralManager(
    _ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any], rssi: NSNumber
  ) {
    guard wanted, heldRelays[peripheral.identifier] == nil else { return }
    heldRelays[peripheral.identifier] = peripheral
    peripheral.delegate = self
    central.connect(peripheral)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.discoverServices([GATT.heartRate, HeartRateRelay.service])
  }

  func centralManager(
    _ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: (any Error)?
  ) {
    reconnectWhenInRange(peripheral, through: central)
  }

  func centralManager(
    _ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
    error: (any Error)?
  ) {
    reconnectWhenInRange(peripheral, through: central)
  }

  private func reconnectWhenInRange(_ peripheral: CBPeripheral, through central: CBCentralManager) {
    guard wanted, heldRelays[peripheral.identifier] != nil else { return }
    central.connect(peripheral)
  }
}

extension CoreBluetoothWatchRelay: @preconcurrency CBPeripheralDelegate {
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: (any Error)?) {
    for service in peripheral.services ?? [] {
      if service.uuid == GATT.heartRate {
        peripheral.discoverCharacteristics([GATT.heartRateMeasurement], for: service)
      } else if service.uuid == HeartRateRelay.service, claim != nil {
        peripheral.discoverCharacteristics(
          [HeartRateRelay.challengeCharacteristic, HeartRateRelay.rideRecordedCharacteristic],
          for: service)
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
      } else if characteristic.uuid == HeartRateRelay.challengeCharacteristic {
        peripheral.readValue(for: characteristic)
      }
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic,
    error: (any Error)?
  ) {
    guard let data = characteristic.value else { return }
    if characteristic.uuid == HeartRateRelay.challengeCharacteristic {
      claimRide(on: peripheral, challenge: data, in: characteristic.service)
    } else if characteristic.uuid == GATT.heartRateMeasurement,
      let measurement = HeartRateMeasurement(data)
    {
      onMeasurement?(peripheral.identifier, measurement)
    }
  }

  private func claimRide(on peripheral: CBPeripheral, challenge: Data, in service: CBService?) {
    guard let claim,
      let rideRecorded = service?.characteristics?.first(where: {
        $0.uuid == HeartRateRelay.rideRecordedCharacteristic
      })
    else { return }
    peripheral.writeValue(claim.sign(challenge), for: rideRecorded, type: .withResponse)
  }
}
