import Foundation

/// Pretend devices for previews and debug builds, where there is no Bluetooth to try the
/// Devices sheet with: a trainer and two heart rate straps, which connect after a moment. A
/// connected strap sends a heart rate each second.
@MainActor
final class SampleTransport: BluetoothTransport {
  var onAvailability: ((BluetoothAvailability) -> Void)?
  var onDiscovery: ((DiscoveredDevice) -> Void)?
  var onConnect: ((UUID) -> Void)?
  var onDisconnect: ((UUID) -> Void)?
  var onConnectFailure: ((UUID) -> Void)?
  var onBattery: ((UUID, Int) -> Void)?
  var onHeartRate: ((UUID, HeartRateMeasurement) -> Void)?
  var onCyclingMeasurement: ((UUID, CyclingCharacteristic, Data) -> Void)?
  private var heartbeats: [UUID: Task<Void, Never>] = [:]

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

  func scan() {
    for device in [Self.strap, Self.otherStrap, DiscoveredDevice(id: UUID(), name: "AirPods")] {
      onDiscovery?(device)
    }
  }

  func stopScan() {}

  func connect(_ id: UUID) {
    heartbeats[id]?.cancel()
    heartbeats[id] = Task {
      try? await Task.sleep(for: .seconds(1))
      guard !Task.isCancelled else { return }
      onConnect?(id)
      if id != Self.trainer.id { onBattery?(id, 78) }
      var beat = 0
      while !Task.isCancelled {
        if id == Self.trainer.id {
          let watts = UInt16(180 + beat % 25)
          let cadence = UInt16((85 + beat % 5) * 2)
          onCyclingMeasurement?(
            id, .indoorBike,
            Data([
              0x45, 0, UInt8(cadence & 0xFF), UInt8(cadence >> 8),
              UInt8(watts & 0xFF), UInt8(watts >> 8),
            ]))
        } else {
          onHeartRate?(id, .init(beatsPerMinute: 124 + beat % 7, hasContact: true))
        }
        beat += 1
        try? await Task.sleep(for: .seconds(1))
      }
    }
  }

  func disconnect(_ id: UUID) {
    heartbeats.removeValue(forKey: id)?.cancel()
  }
}

extension BluetoothDevices {
  /// Pretend devices with the trainer paired, for previews and debug builds. With `pairStrap`
  /// a heart rate strap is paired too.
  public static func sample(pairStrap: Bool = false) -> BluetoothDevices {
    let defaults = UserDefaults(suiteName: "RideBluetooth.sample")!
    defaults.removePersistentDomain(forName: "RideBluetooth.sample")
    let devices = BluetoothDevices(transport: SampleTransport(), defaults: defaults)
    devices.pair(SampleTransport.trainer)
    if pairStrap { devices.pair(SampleTransport.strap) }
    return devices
  }
}
