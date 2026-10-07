import Foundation

/// Pretend devices for previews and debug builds, where there is no Bluetooth to try the
/// Devices sheet with: a trainer and two heart rate straps, which connect after a moment.
@MainActor
final class SampleTransport: BluetoothTransport {
  var onAvailability: ((BluetoothAvailability) -> Void)?
  var onDiscovery: ((DiscoveredDevice) -> Void)?
  var onConnect: ((UUID) -> Void)?
  var onDisconnect: ((UUID) -> Void)?
  var onConnectFailure: ((UUID) -> Void)?
  var onBattery: ((UUID, Int) -> Void)?

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
    Task {
      try? await Task.sleep(for: .seconds(1))
      onConnect?(id)
      if id != Self.trainer.id { onBattery?(id, 78) }
    }
  }

  func disconnect(_ id: UUID) {}
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
