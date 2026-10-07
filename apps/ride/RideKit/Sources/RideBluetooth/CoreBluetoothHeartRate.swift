import CoreBluetooth
import Foundation

@MainActor
final class CoreBluetoothHeartRate: NSObject, HeartRateTransport {
  var onAvailability: ((BluetoothAvailability) -> Void)?
  var onConnect: ((UUID) -> Void)?
  var onDisconnect: ((UUID) -> Void)?
  var onFailure: ((UUID) -> Void)?
  var onMeasurement: ((UUID, HeartRateMeasurement) -> Void)?
  private var central: CBCentralManager?
  /// The sensors being connected to. CoreBluetooth cancels a connection whose peripheral is
  /// released, so they are held here.
  private var peripherals: [UUID: CBPeripheral] = [:]
  private static let service = CBUUID(string: FitnessService.heartRate.rawValue)
  private static let measurement = CBUUID(string: "2A37")

  func start() {
    if central == nil {
      // CoreBluetooth delivers delegate callbacks on the main queue.
      central = CBCentralManager(delegate: self, queue: .main)
    }
  }

  /// Connects once the sensor is in range; CoreBluetooth keeps trying without a timeout.
  func connect(_ id: UUID) {
    guard let central, central.state == .poweredOn else { return }
    guard let peripheral = central.retrievePeripherals(withIdentifiers: [id]).first else {
      onFailure?(id)
      return
    }
    peripheral.delegate = self
    peripherals[id] = peripheral
    central.connect(peripheral)
  }

  func disconnect(_ id: UUID) {
    guard let peripheral = peripherals.removeValue(forKey: id) else { return }
    central?.cancelPeripheralConnection(peripheral)
  }
}

extension CoreBluetoothHeartRate: @preconcurrency CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    // Turning Bluetooth off ends every connection without a callback for each.
    if central.state != .poweredOn { peripherals.removeAll() }
    onAvailability?(BluetoothAvailability(central.state))
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    onConnect?(peripheral.identifier)
    peripheral.discoverServices([Self.service])
  }

  func centralManager(
    _ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: (any Error)?
  ) {
    peripherals[peripheral.identifier] = nil
    onFailure?(peripheral.identifier)
  }

  func centralManager(
    _ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
    error: (any Error)?
  ) {
    // A connection cancelled through `disconnect(_:)` has already been let go.
    guard peripherals.removeValue(forKey: peripheral.identifier) != nil else { return }
    onDisconnect?(peripheral.identifier)
  }
}

extension CoreBluetoothHeartRate: @preconcurrency CBPeripheralDelegate {
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: (any Error)?) {
    for service in peripheral.services ?? [] where service.uuid == Self.service {
      peripheral.discoverCharacteristics([Self.measurement], for: service)
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService,
    error: (any Error)?
  ) {
    for characteristic in service.characteristics ?? []
    where characteristic.uuid == Self.measurement {
      peripheral.setNotifyValue(true, for: characteristic)
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic,
    error: (any Error)?
  ) {
    guard characteristic.uuid == Self.measurement, let data = characteristic.value,
      let measurement = HeartRateMeasurement(data)
    else { return }
    onMeasurement?(peripheral.identifier, measurement)
  }
}
