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

  isolated deinit {
    for heartbeat in heartbeats.values { heartbeat.cancel() }
  }

  static let trainer = DiscoveredDevice(
    id: UUID(uuidString: "6A1C0D4E-2B57-4F0B-9E43-7C1A2B3C4D01")!, name: "KICKR CORE",
    services: [.trainer, .power, .speedAndCadence])
  static let strap = DiscoveredDevice(
    id: UUID(uuidString: "6A1C0D4E-2B57-4F0B-9E43-7C1A2B3C4D02")!, name: "Polar H10",
    services: [.heartRate])
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
        self?.onTrainerControlReady?(id)
      } else {
        self?.onBatteryLevel?(id, Data([78]))
      }
      var beat = 0
      while !Task.isCancelled, self != nil {
        if id == Self.trainer.id {
          let watts = UInt16(self?.ergWatts.map { $0 - 2 + beat % 5 } ?? 180 + beat % 25)
          let cadence = UInt16((85 + beat % 5) * 2)
          self?.onCyclingMeasurement?(
            id, .indoorBike,
            Data([
              0x45, 0, UInt8(cadence & 0xFF), UInt8(cadence >> 8),
              UInt8(watts & 0xFF), UInt8(watts >> 8),
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
    case 0x01, 0x04, 0x11: ergWatts = nil
    default: break
    }
    Task {
      onTrainerValue?(id, .controlPoint, Data([0x80, opCode, 0x01]))
    }
  }
}

extension BluetoothDevices {
  public static func sample(pairStrap: Bool = false) -> BluetoothDevices {
    let defaults = UserDefaults(suiteName: "RideBluetooth.sample")!
    defaults.removePersistentDomain(forName: "RideBluetooth.sample")
    let devices = BluetoothDevices(transport: SampleTransport(), defaults: defaults)
    devices.pair(SampleTransport.trainer)
    if pairStrap { devices.pair(SampleTransport.strap) }
    return devices
  }
}
