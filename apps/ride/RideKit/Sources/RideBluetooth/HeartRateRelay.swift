import CoreBluetooth
import Foundation

/// Makes the iPhone a standard Bluetooth heart rate sensor sending what the Apple Watch
/// measures, so Ride on a Mac, or any other training app, can use the watch like a chest strap.
///
/// Alongside the Heart Rate service it advertises one of Ride's own, so Ride on the Mac can
/// tell the heart rate comes from a watch.
@MainActor
public final class HeartRateRelay: NSObject {
  static let service = CBUUID(string: "46EAB846-7359-4D1E-8DC7-CC90CF575CA1")
  private static let bodySensorLocation = CBUUID(string: "2A38")
  /// Body Sensor Location's value for the wrist.
  private static let wrist: UInt8 = 2

  private var manager: CBPeripheralManager?
  private var measurement: CBMutableCharacteristic?
  private var wanted = false
  /// A heart rate the subscribers' queue had no room for, sent once it does.
  private var pending: Data?

  public func start() {
    wanted = true
    if let manager {
      advertise(manager)
    } else {
      manager = CBPeripheralManager(delegate: self, queue: .main)
    }
  }

  public func stop() {
    wanted = false
    pending = nil
    guard let manager, manager.state == .poweredOn else { return }
    manager.stopAdvertising()
    manager.removeAllServices()
    measurement = nil
  }

  /// Sends `bpm` to every app listening.
  public func send(bpm: Int) {
    guard let manager, let measurement else { return }
    let data = HeartRateMeasurement(beatsPerMinute: bpm, hasContact: true).data
    pending = manager.updateValue(data, for: measurement, onSubscribedCentrals: nil) ? nil : data
  }

  private func advertise(_ manager: CBPeripheralManager) {
    guard wanted, manager.state == .poweredOn, measurement == nil else { return }
    let measurement = CBMutableCharacteristic(
      type: GATT.heartRateMeasurement, properties: .notify, value: nil, permissions: [])
    let location = CBMutableCharacteristic(
      type: Self.bodySensorLocation, properties: .read, value: Data([Self.wrist]),
      permissions: .readable)
    let heartRate = CBMutableService(type: GATT.heartRate, primary: true)
    heartRate.characteristics = [measurement, location]
    manager.add(heartRate)
    manager.add(CBMutableService(type: Self.service, primary: true))
    self.measurement = measurement
    manager.startAdvertising([
      CBAdvertisementDataLocalNameKey: "Ride",
      CBAdvertisementDataServiceUUIDsKey: [GATT.heartRate, Self.service],
    ])
  }
}

extension HeartRateRelay: @preconcurrency CBPeripheralManagerDelegate {
  public func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    if peripheral.state == .poweredOn {
      advertise(peripheral)
    } else {
      // Services are gone once Bluetooth turns off, and are added again when it is back.
      measurement = nil
      pending = nil
    }
  }

  public func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    guard let pending, let measurement else { return }
    if peripheral.updateValue(pending, for: measurement, onSubscribedCentrals: nil) {
      self.pending = nil
    }
  }
}
