import CoreBluetooth
import Foundation

/// Makes the iPhone a standard Bluetooth heart rate sensor sending what the Apple Watch
/// measures, so Ride on a Mac, or any other training app, can use the watch like a chest strap.
///
/// Alongside the Heart Rate service it advertises one of Ride's own, so Ride on the Mac can
/// tell the heart rate comes from a watch, and say that it records the ride.
@MainActor
public final class HeartRateRelay: NSObject {
  static let service = CBUUID(string: "46EAB846-7359-4D1E-8DC7-CC90CF575CA1")
  /// Written by Ride on a Mac that records the ride and saves it to Health through iCloud, with
  /// `challenge` signed by its `RideClaim`.
  static let rideRecorded = CBUUID(string: "D73F6701-C585-461B-B225-B1A15B93926E")
  /// A fresh value for a Mac to sign, replaced each time the relay starts and once a claim has
  /// used it.
  static let challenge = CBUUID(string: "58B5A803-7F11-4797-AB40-7C1E0B855255")
  private static let bodySensorLocation = CBUUID(string: "2A38")
  /// Body Sensor Location's value for the wrist.
  private static let wrist: UInt8 = 2

  /// Called when Ride on a Mac signed in to the rider's account says it records the ride.
  public var onRideRecorded: (() -> Void)?
  /// The rider's claim, without which no Mac can claim a ride. Asked for as a Mac claims one.
  public var claim: () -> RideClaim? = { nil }
  private var challenge = RideClaim.challenge()
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
    challenge = RideClaim.challenge()
    let ride = CBMutableService(type: Self.service, primary: true)
    ride.characteristics = [
      CBMutableCharacteristic(
        type: Self.challenge, properties: .read, value: nil, permissions: .readable),
      CBMutableCharacteristic(
        type: Self.rideRecorded, properties: .write, value: nil, permissions: .writeable),
    ]
    manager.add(ride)
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

  public func peripheralManager(
    _ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]
  ) {
    guard let first = requests.first else { return }
    guard requests.count == 1, first.characteristic.uuid == Self.rideRecorded else {
      peripheral.respond(to: first, withResult: .requestNotSupported)
      return
    }
    guard let claim = claim(), let signature = first.value,
      claim.verifies(signature, for: challenge)
    else {
      peripheral.respond(to: first, withResult: .insufficientAuthentication)
      return
    }
    challenge = RideClaim.challenge()
    peripheral.respond(to: first, withResult: .success)
    onRideRecorded?()
  }

  public func peripheralManager(
    _ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest
  ) {
    guard request.characteristic.uuid == Self.challenge else {
      peripheral.respond(to: request, withResult: .requestNotSupported)
      return
    }
    guard request.offset <= challenge.count else {
      peripheral.respond(to: request, withResult: .invalidOffset)
      return
    }
    request.value = challenge.subdata(in: request.offset..<challenge.count)
    peripheral.respond(to: request, withResult: .success)
  }

  public func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    guard let pending, let measurement else { return }
    if peripheral.updateValue(pending, for: measurement, onSubscribedCentrals: nil) {
      self.pending = nil
    }
  }
}
