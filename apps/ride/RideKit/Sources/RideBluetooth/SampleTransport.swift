import Foundation

@MainActor
final class SampleTransport: BluetoothTransport {
  var onAvailability: ((BluetoothAvailability) -> Void)?
  var onDiscovery: ((DiscoveredDevice) -> Void)?
  var onConnect: ((UUID) -> Void)?
  var onDisconnect: ((UUID) -> Void)?
  var onConnectFailure: ((UUID) -> Void)?
  var onBatteryLevel: ((UUID, Data) -> Void)?
  var onHeartRateMeasurement: ((UUID, Data) -> Void)?
  var onCyclingMeasurement: ((UUID, CyclingCharacteristic, Data) -> Void)?
  var onTrainerControlReady: ((UUID) -> Void)?
  var onTrainerValue: ((UUID, TrainerCharacteristic, Data) -> Void)?
  private var heartbeats: [UUID: Task<Void, Never>] = [:]
  private var ergWatts: Int?
  private var spinDownSpeed: Double?
  private var isCoasting = false
  static let spinDownTargetKilometresPerHour = 30.0...35.0
  static let spinDownAcceleration = 2.5
  static let spinDownDeceleration = 3.0
  static let spinDownStoppedBelow = 8.0

  isolated deinit {
    for heartbeat in heartbeats.values { heartbeat.cancel() }
  }

  static let trainer = DiscoveredDevice(
    id: UUID(uuidString: "6A1C0D4E-2B57-4F0B-9E43-7C1A2B3C4D01")!, name: "KICKR CORE",
    services: [.trainer, .power, .speedAndCadence])
  static let strap = DiscoveredDevice(
    id: UUID(uuidString: "6A1C0D4E-2B57-4F0B-9E43-7C1A2B3C4D02")!, name: "Polar H10",
    services: [.heartRate])
  static let powerMeter = DiscoveredDevice(
    id: UUID(uuidString: "6A1C0D4E-2B57-4F0B-9E43-7C1A2B3C4D04")!, name: "Assioma DUO",
    services: [.power])
  static let powerMeterShareOfTrainer = 0.95
  static let otherStrap = DiscoveredDevice(
    id: UUID(uuidString: "6A1C0D4E-2B57-4F0B-9E43-7C1A2B3C4D03")!, name: "HRM-Pro",
    services: [.heartRate])

  func start() { onAvailability?(.ready) }

  func scanAllDevices() {
    for device in [Self.strap, Self.otherStrap, DiscoveredDevice(id: UUID(), name: "AirPods")] {
      onDiscovery?(device)
    }
  }

  func stopScan() {}

  func connectWhenInRange(_ id: UUID) {
    heartbeats[id]?.cancel()
    heartbeats[id] = Task { [weak self] in
      do { try await Task.sleep(for: .seconds(1)) } catch { return }
      guard !Task.isCancelled else { return }
      self?.onConnect?(id)
      if id == Self.trainer.id {
        self?.onTrainerValue?(id, .powerRange, Data([0, 0, 0xD0, 0x07, 1, 0]))
        self?.onTrainerValue?(id, .resistanceRange, Data([0, 0, 0xE8, 0x03, 10, 0]))
        self?.onTrainerValue?(id, .feature, Data([0, 0, 0, 0, 0x0C, 0xA0, 0, 0]))
        self?.onTrainerControlReady?(id)
      } else {
        self?.onBatteryLevel?(id, Data([78]))
      }
      var beat = 0
      while !Task.isCancelled, self != nil {
        if id == Self.trainer.id, let speed = self?.spinDownSpeed {
          self?.spinDown(speed, from: id)
        } else if id == Self.trainer.id {
          let watts = UInt16(self?.ergWatts.map { $0 - 2 + beat % 5 } ?? 180 + beat % 25)
          let cadence = UInt16((85 + beat % 5) * 2)
          self?.onCyclingMeasurement?(
            id, .indoorBike,
            Data([
              0x45, 0, UInt8(cadence & 0xFF), UInt8(cadence >> 8),
              UInt8(watts & 0xFF), UInt8(watts >> 8),
            ]))
        } else if id == Self.powerMeter.id {
          let trainerWatts = Double(self?.ergWatts ?? 180)
          let watts = UInt16(trainerWatts * Self.powerMeterShareOfTrainer) + UInt16(beat % 3)
          let revolutions = UInt16(truncatingIfNeeded: beat * 3 / 2)
          let eventTime = UInt16(truncatingIfNeeded: Int(revolutions) * 1024 * 2 / 3)
          self?.onCyclingMeasurement?(
            id, .power,
            Data([
              0x20, 0, UInt8(watts & 0xFF), UInt8(watts >> 8), UInt8(revolutions & 0xFF),
              UInt8(revolutions >> 8), UInt8(eventTime & 0xFF), UInt8(eventTime >> 8),
            ]))
        } else {
          self?.onHeartRateMeasurement?(
            id, HeartRateMeasurement(beatsPerMinute: 124 + beat % 7, hasContact: true).data)
        }
        beat += 1
        do { try await Task.sleep(for: .seconds(1)) } catch { break }
      }
    }
  }

  func disconnect(_ id: UUID) {
    heartbeats.removeValue(forKey: id)?.cancel()
    if id == Self.trainer.id { ergWatts = nil }
  }

  func writeTrainerControl(_ data: Data, to id: UUID) {
    guard let opCode = data.first else { return }
    var reader = BluetoothValueReader(data.dropFirst())
    switch opCode {
    case 0x05: ergWatts = reader.uint16().map { Int(Int16(bitPattern: $0)) }
    case 0x01, 0x04, 0x11:
      ergWatts = nil
      spinDownSpeed = nil
    case 0x13:
      spinDownSpeed = 20
      isCoasting = false
      let low = UInt16(Self.spinDownTargetKilometresPerHour.lowerBound * 100)
      let high = UInt16(Self.spinDownTargetKilometresPerHour.upperBound * 100)
      Task {
        onTrainerValue?(
          id, .controlPoint,
          Data([
            0x80, opCode, 0x01, UInt8(low & 0xFF), UInt8(low >> 8), UInt8(high & 0xFF),
            UInt8(high >> 8),
          ]))
      }
      return
    default: break
    }
    Task {
      onTrainerValue?(id, .controlPoint, Data([0x80, opCode, 0x01]))
    }
  }
}

extension SampleTransport {
  private func spinDown(_ speed: Double, from id: UUID) {
    let next =
      isCoasting
      ? speed - Self.spinDownDeceleration : speed + Self.spinDownAcceleration
    let units = UInt16(max(0, next) * 100)
    onCyclingMeasurement?(
      id, .indoorBike,
      Data([0x44, 0, UInt8(units & 0xFF), UInt8(units >> 8), isCoasting ? 0 : 180, 0, 0, 0]))
    if !isCoasting, next > Self.spinDownTargetKilometresPerHour.upperBound {
      isCoasting = true
      onTrainerValue?(id, .status, Data([0x14, 0x04]))
    } else if isCoasting, next < Self.spinDownStoppedBelow {
      spinDownSpeed = nil
      onTrainerValue?(id, .status, Data([0x14, 0x02]))
      return
    }
    spinDownSpeed = next
  }
}

extension BluetoothDevices {
  public static func sample(pairStrap: Bool = false, pairPowerMeter: Bool = false)
    -> BluetoothDevices
  {
    let defaults = UserDefaults(suiteName: "RideBluetooth.sample")!
    defaults.removePersistentDomain(forName: "RideBluetooth.sample")
    let devices = BluetoothDevices(transport: SampleTransport(), defaults: defaults)
    devices.pair(SampleTransport.trainer)
    if pairStrap { devices.pair(SampleTransport.strap) }
    if pairPowerMeter { devices.pair(SampleTransport.powerMeter) }
    return devices
  }
}
