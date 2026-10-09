import CoreBluetooth

/// The Bluetooth services and characteristics Ride reads, beyond the ones that identify a
/// fitness device.
@MainActor
enum GATT {
  static let heartRate = CBUUID(string: FitnessService.heartRate.rawValue)
  static let heartRateMeasurement = CBUUID(string: "2A37")
  static let battery = CBUUID(string: "180F")
  static let batteryLevel = CBUUID(string: "2A19")
  static let power = CBUUID(string: FitnessService.power.rawValue)
  static let speedAndCadence = CBUUID(string: FitnessService.speedAndCadence.rawValue)
  static let trainer = CBUUID(string: FitnessService.trainer.rawValue)
  static let cyclingPowerMeasurement = CBUUID(string: CyclingCharacteristic.power.rawValue)
  static let cyclingSpeedCadenceMeasurement = CBUUID(
    string: CyclingCharacteristic.speedAndCadence.rawValue)
  static let indoorBikeData = CBUUID(string: CyclingCharacteristic.indoorBike.rawValue)
}
