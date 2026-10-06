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

  func scan(showAll: Bool) {
    guard let central, central.state == .poweredOn else { return }
    let services = showAll ? nil : FitnessService.allCases.map { CBUUID(string: $0.rawValue) }
    central.scanForPeripherals(withServices: services)
  }

  func stopScan() {
    guard let central, central.state == .poweredOn else { return }
    central.stopScan()
  }
}

extension CoreBluetoothDiscovery: @preconcurrency CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    let availability: BluetoothAvailability
    switch central.state {
    case .poweredOn: availability = .ready
    case .poweredOff: availability = .poweredOff
    case .unauthorized: availability = .unauthorized
    case .unsupported: availability = .unsupported
    case .resetting: availability = .resetting
    case .unknown: availability = .unknown
    @unknown default: availability = .unknown
    }
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
}
