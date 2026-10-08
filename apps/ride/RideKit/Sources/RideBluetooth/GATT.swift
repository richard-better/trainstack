import CoreBluetooth

/// The Bluetooth services and characteristics Ride reads, beyond the ones that identify a
/// fitness device.
@MainActor
enum GATT {
  static let heartRate = CBUUID(string: FitnessService.heartRate.rawValue)
  static let heartRateMeasurement = CBUUID(string: "2A37")
  static let battery = CBUUID(string: "180F")
  static let batteryLevel = CBUUID(string: "2A19")
}
