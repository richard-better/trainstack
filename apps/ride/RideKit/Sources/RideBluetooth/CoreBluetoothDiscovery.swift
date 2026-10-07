import CoreBluetooth
import Foundation

@MainActor
final class CoreBluetoothDiscovery: NSObject, DiscoveryTransport {
  var onAvailability: ((BluetoothAvailability) -> Void)?
  var onDiscovery: ((DiscoveredDevice) -> Void)?
  private var central: CBCentralManager?

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
}

extension CoreBluetoothDiscovery: @preconcurrency CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    onAvailability?(BluetoothAvailability(central.state))
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
}
