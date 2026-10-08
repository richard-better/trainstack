import Foundation
import Observation

public enum BluetoothAvailability: Sendable {
  case unknown, ready, poweredOff, unauthorized, unsupported, resetting
}

public enum FitnessService: String, CaseIterable, Codable, Sendable {
  case trainer = "1826"
  case heartRate = "180D"
  case power = "1818"
  case speedAndCadence = "1816"

  public var name: String {
    switch self {
    case .trainer: "Smart trainer"
    case .heartRate: "Heart rate"
    case .power: "Power meter"
    case .speedAndCadence: "Speed / cadence"
    }
  }
}

public struct DiscoveredDevice: Identifiable, Equatable, Codable, Sendable {
  public let id: UUID
  public var name: String?
  public var services: Set<FitnessService>

  public var displayName: String { name ?? "Unnamed device" }
  public var isFitness: Bool { !services.isEmpty }

  /// What the device is first of all. A trainer also measures power and cadence, and a power
  /// meter often cadence too, so the more capable role wins.
  public var kind: FitnessService? {
    [FitnessService.trainer, .power, .heartRate, .speedAndCadence].first(where: services.contains)
  }

  public init(id: UUID, name: String? = nil, services: Set<FitnessService> = []) {
    self.id = id
    self.name = name
    self.services = services
  }
}

@MainActor
protocol BluetoothTransport: AnyObject {
  var onAvailability: ((BluetoothAvailability) -> Void)? { get set }
  var onDiscovery: ((DiscoveredDevice) -> Void)? { get set }
  var onConnect: ((UUID) -> Void)? { get set }
  /// A connection that was up has dropped.
  var onDisconnect: ((UUID) -> Void)? { get set }
  /// A connection attempt failed without connecting.
  var onConnectFailure: ((UUID) -> Void)? { get set }
  /// A device reported its battery level, in percent.
  var onBattery: ((UUID, Int) -> Void)? { get set }
  /// A heart rate strap sent a reading.
  var onHeartRate: ((UUID, HeartRateMeasurement) -> Void)? { get set }
  func start()
  func scan()
  func stopScan()
  /// Connects to `id` whenever it comes into range. The request does not time out.
  func connect(_ id: UUID)
  func disconnect(_ id: UUID)
}

/// Nearby Bluetooth devices, and the fitness devices the rider has paired: one of each kind,
/// remembered between launches and reconnected whenever they are in range. Passes on the heart
/// rate from the paired strap.
@MainActor
@Observable
public final class BluetoothDevices {
  public private(set) var availability: BluetoothAvailability = .unknown
  public private(set) var isScanning = false
  /// The devices the rider has paired, in the order they were paired.
  public private(set) var paired: [DiscoveredDevice]
  /// Nearby devices that advertise at least one fitness service, other than paired ones.
  public var fitnessDevices: [DiscoveredDevice] {
    sorted(discovered.values.filter { $0.isFitness && !isPaired($0.id) })
  }
  /// Everything else in range, such as TVs, phones and headphones.
  public var otherDevices: [DiscoveredDevice] { sorted(discovered.values.filter { !$0.isFitness }) }
  /// The latest heart rate from the connected strap in beats per minute, or nil while it sends
  /// none, such as when it is not being worn.
  public var heartRate: Int? {
    guard let heartRateReading, source(of: .heartRate)?.id == heartRateReading.device else {
      return nil
    }
    return heartRateReading.bpm
  }
  /// Called with each heart rate the strap sends, so a ride can record every beat rather than
  /// only the latest.
  @ObservationIgnored public var onHeartRate: ((Int) -> Void)?

  private var discovered: [UUID: DiscoveredDevice] = [:]
  private var connections: [UUID: ConnectionState] = [:]
  private var batteryLevels: [UUID: Int] = [:]
  private var heartRateReading: (device: UUID, bpm: Int)?
  @ObservationIgnored private let transport: any BluetoothTransport
  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored private var wantsScan = false
  @ObservationIgnored private var hasStarted = false

  private static let pairedKey = "bluetooth.paired"
  /// Where Ride kept its one heart rate strap before it paired a device of each kind.
  private static let legacyHeartRateKey = "pairedHeartRateSensor"

  public convenience init() {
    self.init(transport: CoreBluetoothTransport(), defaults: .standard)
  }

  init(transport: any BluetoothTransport, defaults: UserDefaults) {
    self.transport = transport
    self.defaults = defaults
    paired =
      defaults.data(forKey: Self.pairedKey).flatMap {
        try? JSONDecoder().decode([DiscoveredDevice].self, from: $0)
      } ?? []
    adoptLegacyHeartRateSensor()
    transport.onAvailability = { [weak self] state in self?.updateAvailability(state) }
    transport.onDiscovery = { [weak self] device in self?.receive(device) }
    transport.onConnect = { [weak self] id in self?.didConnect(id) }
    transport.onDisconnect = { [weak self] id in self?.didDisconnect(id) }
    transport.onConnectFailure = { [weak self] id in self?.didFailToConnect(id) }
    transport.onBattery = { [weak self] id, level in self?.batteryLevels[id] = level }
    transport.onHeartRate = { [weak self] id, measurement in self?.receive(measurement, from: id) }
  }

  public func connectionState(of id: UUID) -> ConnectionState {
    connections[id] ?? .disconnected
  }

  public func batteryLevel(of id: UUID) -> Int? { batteryLevels[id] }

  /// The paired device of `kind`, if there is one.
  public func paired(_ kind: FitnessService) -> DiscoveredDevice? {
    paired.first { $0.kind == kind }
  }

  /// The connected device that supplies `metric`, in the order of the metric's preferred
  /// sources.
  public func source(of metric: RideMetric) -> DiscoveredDevice? {
    let connected = paired.filter { connectionState(of: $0.id) == .connected }
    for service in metric.sources {
      if let device = connected.first(where: { $0.services.contains(service) }) { return device }
    }
    return nil
  }

  /// Reconnects the paired devices. Bluetooth is only started once there is something to
  /// connect, so the permission prompt waits until the rider looks for a device.
  public func connectPaired() {
    guard !paired.isEmpty else { return }
    start()
  }

  /// Remembers `device` and connects to it, in place of any paired device of the same kind.
  public func pair(_ device: DiscoveredDevice) {
    guard device.isFitness else { return }
    for other in paired where other.id != device.id && other.kind == device.kind {
      forget(other.id)
    }
    if !isPaired(device.id) {
      paired.append(device)
      save()
    }
    connect(device.id)
  }

  /// Tries again to connect to a paired device whose last attempt failed.
  public func reconnect(_ id: UUID) {
    guard isPaired(id) else { return }
    connect(id)
  }

  /// Disconnects `id` and stops remembering it.
  public func forget(_ id: UUID) {
    guard isPaired(id) else { return }
    paired.removeAll { $0.id == id }
    save()
    connections[id] = nil
    batteryLevels[id] = nil
    if heartRateReading?.device == id { heartRateReading = nil }
    transport.disconnect(id)
  }

  public func startScanning() {
    guard !wantsScan else { return }
    discovered.removeAll()
    wantsScan = true
    start()
    if availability == .ready, !isScanning { scan() }
  }

  public func stopScanning() {
    wantsScan = false
    isScanning = false
    transport.stopScan()
  }

  private func start() {
    guard !hasStarted else { return }
    hasStarted = true
    transport.start()
  }

  private func scan() {
    guard !isScanning else { return }
    isScanning = true
    transport.scan()
  }

  private func connect(_ id: UUID) {
    guard availability == .ready else { return }
    connections[id] = .connecting
    transport.connect(id)
  }

  private func isPaired(_ id: UUID) -> Bool { paired.contains { $0.id == id } }

  private func save() {
    defaults.set(try? JSONEncoder().encode(paired), forKey: Self.pairedKey)
  }

  /// Pairs the strap saved under the old key, so the rider need not pair it again.
  private func adoptLegacyHeartRateSensor() {
    struct LegacySensor: Decodable {
      let id: UUID
      let name: String
    }
    guard let data = defaults.data(forKey: Self.legacyHeartRateKey) else { return }
    defaults.removeObject(forKey: Self.legacyHeartRateKey)
    guard paired(.heartRate) == nil,
      let sensor = try? JSONDecoder().decode(LegacySensor.self, from: data)
    else { return }
    paired.append(DiscoveredDevice(id: sensor.id, name: sensor.name, services: [.heartRate]))
    save()
  }

  private func updateAvailability(_ state: BluetoothAvailability) {
    availability = state
    if state == .ready {
      if wantsScan { scan() }
      for device in paired where connectionState(of: device.id) == .disconnected {
        connect(device.id)
      }
    } else {
      isScanning = false
      discovered.removeAll()
      connections.removeAll()
      batteryLevels.removeAll()
      heartRateReading = nil
      transport.stopScan()
    }
  }

  private func didConnect(_ id: UUID) {
    guard isPaired(id) else {
      transport.disconnect(id)
      return
    }
    connections[id] = .connected
  }

  /// A paired device that drops, such as one switched off or carried out of range, is
  /// reconnected as soon as it is back.
  private func didDisconnect(_ id: UUID) {
    batteryLevels[id] = nil
    if heartRateReading?.device == id { heartRateReading = nil }
    guard isPaired(id) else { return }
    connections[id] = .disconnected
    connect(id)
  }

  private func didFailToConnect(_ id: UUID) {
    guard isPaired(id) else { return }
    connections[id] = .disconnected
  }

  private func receive(_ measurement: HeartRateMeasurement, from id: UUID) {
    guard source(of: .heartRate)?.id == id else { return }
    let bpm = measurement.reading
    heartRateReading = bpm.map { (id, $0) }
    if let bpm { onHeartRate?(bpm) }
  }

  private func sorted(_ devices: [DiscoveredDevice]) -> [DiscoveredDevice] {
    devices.sorted {
      let order = $0.displayName.localizedStandardCompare($1.displayName)
      return order == .orderedSame
        ? $0.id.uuidString < $1.id.uuidString : order == .orderedAscending
    }
  }

  private func receive(_ device: DiscoveredDevice) {
    guard isScanning else { return }
    if var existing = discovered[device.id] {
      if let name = device.name, !name.isEmpty { existing.name = name }
      existing.services.formUnion(device.services)
      discovered[device.id] = existing
    } else {
      var device = device
      if device.name?.isEmpty == true { device.name = nil }
      discovered[device.id] = device
    }
  }
}
