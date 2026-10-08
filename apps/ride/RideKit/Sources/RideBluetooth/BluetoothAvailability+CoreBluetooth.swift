import CoreBluetooth

extension BluetoothAvailability {
  init(_ state: CBManagerState) {
    switch state {
    case .poweredOn: self = .ready
    case .poweredOff: self = .poweredOff
    case .unauthorized: self = .unauthorized
    case .unsupported: self = .unsupported
    case .resetting: self = .resetting
    case .unknown: self = .unknown
    @unknown default: self = .unknown
    }
  }
}
