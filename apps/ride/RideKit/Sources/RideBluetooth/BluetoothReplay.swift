import Foundation

@MainActor
struct BluetoothReplay {
  struct Tick: Equatable, Sendable {
    var power: Int?
    var cadence: Int?
    var heartRate: Int?
  }

  let ticks: [Tick]
  let recordedWrites: [Data]
  let replayedWrites: [Data]

  init(jsonLines data: Data) {
    let decoder = JSONDecoder()
    var segments: [Segment] = []
    for line in data.split(separator: UInt8(ascii: "\n")) {
      if let entry = try? decoder.decode(BluetoothLogEntry.self, from: line) {
        segments.last?.replay(entry)
      } else if let header = try? decoder.decode(BluetoothLogHeader.self, from: line) {
        segments.append(Segment(header))
      }
    }
    ticks = segments.flatMap(\.ticks)
    recordedWrites = segments.flatMap(\.recordedWrites)
    replayedWrites = segments.flatMap(\.replayedWrites)
  }
}

@MainActor
private final class Segment {
  private let transport = ReplayTransport()
  private var devices: BluetoothDevices!
  private let defaults: UserDefaults
  private let suiteName = "RideBluetooth.replay.\(UUID().uuidString)"
  private var clock = Date.distantPast
  private var recording = false
  private(set) var ticks: [BluetoothReplay.Tick] = []
  private(set) var recordedWrites: [Data] = []
  private(set) var replayedWrites: [Data] = []

  init(_ header: BluetoothLogHeader) {
    defaults = UserDefaults(suiteName: suiteName)!
    let paired = header.paired.map {
      DiscoveredDevice(id: Self.id(of: $0.device), name: nil, services: $0.services)
    }
    defaults.set(try? JSONEncoder().encode(paired), forKey: "bluetooth.paired")
    defaults.set(
      try? JSONEncoder().encode(header.picks.mapValues(Self.id(of:))),
      forKey: "bluetooth.sourcePicks")
    devices = BluetoothDevices(transport: transport, defaults: defaults) { [unowned self] in
      clock
    }
    transport.onWrite = { [unowned self] data in if recording { replayedWrites.append(data) } }
  }

  isolated deinit { UserDefaults.standard.removePersistentDomain(forName: suiteName) }

  private static func id(of device: Int) -> UUID {
    UUID(uuidString: String(format: "00000000-0000-0000-0000-%012X", device))!
  }

  func replay(_ entry: BluetoothLogEntry) {
    clock = entry.time
    let id = entry.device.map(Self.id(of:)) ?? UUID()
    let bytes = entry.bytes ?? Data()
    switch entry.event {
    case .availability:
      entry.availability.map { transport.onAvailability?($0) }
    case .connected: transport.onConnect?(id)
    case .disconnected: transport.onDisconnect?(id)
    case .connectFailed: transport.onConnectFailure?(id)
    case .battery: transport.onBatteryLevel?(id, bytes)
    case .heartRate: transport.onHeartRateMeasurement?(id, bytes)
    case .cycling:
      if let characteristic = entry.characteristic.flatMap(CyclingCharacteristic.init) {
        transport.onCyclingMeasurement?(id, characteristic, bytes)
      }
    case .trainerReady: transport.onTrainerControlReady?(id)
    case .trainer:
      if let characteristic = entry.characteristic.flatMap(TrainerCharacteristic.init) {
        transport.onTrainerValue?(id, characteristic, bytes)
      }
    case .target:
      recording = true
      devices.setTrainerTarget(entry.target, at: clock)
    case .pick:
      entry.metric.map { devices.select(.init(id: id, name: nil, services: []), for: $0) }
    case .write:
      if recording { recordedWrites.append(bytes) }
    case .tick:
      ticks.append(
        .init(
          power: devices.reading(for: .power, at: clock),
          cadence: devices.reading(for: .cadence, at: clock),
          heartRate: devices.reading(for: .heartRate, at: clock)))
    }
  }
}

@MainActor
private final class ReplayTransport: BluetoothTransport {
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
  var onWrite: ((Data) -> Void)?

  func start() {}
  func scanAllDevices() {}
  func stopScan() {}
  func connectWhenInRange(_ id: UUID) {}
  func disconnect(_ id: UUID) {}
  func writeTrainerControl(_ data: Data, to id: UUID) { onWrite?(data) }
}
