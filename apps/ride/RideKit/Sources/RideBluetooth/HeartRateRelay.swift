import CoreBluetooth
import Foundation

@MainActor
public final class HeartRateRelay: NSObject {
  static let service = CBUUID(string: "46EAB846-7359-4D1E-8DC7-CC90CF575CA1")
  static let rideRecordedCharacteristic = CBUUID(string: "D73F6701-C585-461B-B225-B1A15B93926E")
  static let challengeCharacteristic = CBUUID(string: "58B5A803-7F11-4797-AB40-7C1E0B855255")
  private static let bodySensorLocation = CBUUID(string: "2A38")
  private static let bodySensorLocationWrist: UInt8 = 2

  public var onRideRecorded: (() -> Void)?
  public var claim: () -> RideClaim? = { nil }
  private var challenge = RideClaimChallenge()
  private var manager: CBPeripheralManager?
  private var measurement: CBMutableCharacteristic?
  private var wanted = false
  private var measurementWaitingForQueueSpace: Data?

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
    measurementWaitingForQueueSpace = nil
    guard let manager, manager.state == .poweredOn else { return }
    manager.stopAdvertising()
    manager.removeAllServices()
    measurement = nil
  }

  public func send(bpm: Int) {
    guard let manager, let measurement else { return }
    let data = HeartRateMeasurement(beatsPerMinute: bpm, hasContact: true).data
    let sent = manager.updateValue(data, for: measurement, onSubscribedCentrals: nil)
    measurementWaitingForQueueSpace = sent ? nil : data
  }

  private func advertise(_ manager: CBPeripheralManager) {
    guard wanted, manager.state == .poweredOn, measurement == nil else { return }
    let measurement = CBMutableCharacteristic(
      type: GATT.heartRateMeasurement, properties: .notify, value: nil, permissions: [])
    let location = CBMutableCharacteristic(
      type: Self.bodySensorLocation, properties: .read, value: Data([Self.bodySensorLocationWrist]),
      permissions: .readable)
    let heartRate = CBMutableService(type: GATT.heartRate, primary: true)
    heartRate.characteristics = [measurement, location]
    manager.add(heartRate)
    challenge.renew()
    let ride = CBMutableService(type: Self.service, primary: true)
    ride.characteristics = [
      CBMutableCharacteristic(
        type: Self.challengeCharacteristic, properties: .read, value: nil, permissions: .readable),
      CBMutableCharacteristic(
        type: Self.rideRecordedCharacteristic, properties: .write, value: nil,
        permissions: .writeable),
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
      measurement = nil
      measurementWaitingForQueueSpace = nil
    }
  }

  public func peripheralManager(
    _ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]
  ) {
    guard let first = requests.first else { return }
    guard requests.count == 1, first.characteristic.uuid == Self.rideRecordedCharacteristic else {
      peripheral.respond(to: first, withResult: .requestNotSupported)
      return
    }
    guard let claim = claim(), let signature = first.value,
      challenge.accept(signature, from: claim)
    else {
      peripheral.respond(to: first, withResult: .insufficientAuthentication)
      return
    }
    peripheral.respond(to: first, withResult: .success)
    onRideRecorded?()
  }

  public func peripheralManager(
    _ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest
  ) {
    guard request.characteristic.uuid == Self.challengeCharacteristic else {
      peripheral.respond(to: request, withResult: .requestNotSupported)
      return
    }
    let value = challenge.value
    guard request.offset <= value.count else {
      peripheral.respond(to: request, withResult: .invalidOffset)
      return
    }
    request.value = value.subdata(in: request.offset..<value.count)
    peripheral.respond(to: request, withResult: .success)
  }

  public func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    guard let waiting = measurementWaitingForQueueSpace, let measurement else { return }
    if peripheral.updateValue(waiting, for: measurement, onSubscribedCentrals: nil) {
      measurementWaitingForQueueSpace = nil
    }
  }
}
