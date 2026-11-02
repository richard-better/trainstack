import Foundation
import Observation

@MainActor
@Observable
public final class BluetoothDevices {
  public private(set) var availability: BluetoothAvailability = .unknown
  public private(set) var isScanning = false
  public private(set) var paired: [DiscoveredDevice]
  public var fitnessDevices: [DiscoveredDevice] {
    sorted(discovered.values.filter { $0.isFitness && !isPaired($0.id) })
  }
  public var otherDevices: [DiscoveredDevice] { sorted(discovered.values.filter { !$0.isFitness }) }
  public var heartRate: Int? { reading(for: .heartRate) }
  public var power: Int? { reading(for: .power) }
  public var cadence: Int? { reading(for: .cadence) }
  @ObservationIgnored public var onHeartRate: ((Int) -> Void)?
  @ObservationIgnored public var onCyclingActivity: (() -> Void)?

  private var discovered: [UUID: DiscoveredDevice] = [:]
  private var connections: [UUID: ConnectionState] = [:]
  private var batteryLevels: [UUID: Int] = [:]
  private var heartRateReadings: [UUID: (bpm: Int, date: Date)] = [:]
  private var cyclingReadings: [UUID: CyclingSensorReadings] = [:]
  @ObservationIgnored private var lastHeard: [UUID: Date] = [:]
  private var sourcePicks: [RideMetric: UUID] = [:]
  @ObservationIgnored private let transport: any BluetoothTransport
  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored private var wantsScan = false
  @ObservationIgnored private var hasStarted = false
  @ObservationIgnored private var expiryTask: Task<Void, Never>?
  @ObservationIgnored private var trainerTarget: TrainerTarget?
  @ObservationIgnored private var trainerControls: [UUID: FitnessMachineControl] = [:]

  private static let pairedKey = "bluetooth.paired"
  private static let sourcePicksKey = "bluetooth.sourcePicks"
  private static let heartRateMaxAge: TimeInterval = 5
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
    sourcePicks =
      defaults.data(forKey: Self.sourcePicksKey).flatMap {
        try? JSONDecoder().decode([RideMetric: UUID].self, from: $0)
      } ?? [:]
    adoptLegacyHeartRateSensor()
    transport.onAvailability = { [weak self] state in self?.updateAvailability(state) }
    transport.onDiscovery = { [weak self] device in self?.receive(device) }
    transport.onConnect = { [weak self] id in self?.didConnect(id) }
    transport.onDisconnect = { [weak self] id in self?.didDisconnect(id) }
    transport.onConnectFailure = { [weak self] id in self?.didFailToConnect(id) }
    transport.onBatteryPercent = { [weak self] id, percent in self?.batteryLevels[id] = percent }
    transport.onHeartRate = { [weak self] id, measurement in self?.receive(measurement, from: id) }
    transport.onCyclingMeasurement = { [weak self] id, characteristic, data in
      self?.receiveCycling(data, from: id, characteristic: characteristic)
    }
    transport.onTrainerControlReady = { [weak self] id in
      self?.updateTrainerControl(id) { $0.becameReady(at: .now) }
    }
    transport.onTrainerValue = { [weak self] id, characteristic, data in
      self?.updateTrainerControl(id) { $0.receive(data, from: characteristic, at: .now) }
    }
  }

  public func connectionState(of id: UUID) -> ConnectionState {
    connections[id] ?? .disconnected
  }

  public func batteryLevel(of id: UUID) -> Int? { batteryLevels[id] }

  public func lastHeard(from id: UUID) -> Date? {
    guard connectionState(of: id) == .connected else { return nil }
    return lastHeard[id]
  }

  public func reading(for metric: RideMetric, at date: Date = .now) -> Int? {
    guard let source = source(of: metric) else { return nil }
    return reading(for: metric, from: source.id, at: date)
  }

  public func reading(for metric: RideMetric, from id: UUID, at date: Date = .now) -> Int? {
    guard connectionState(of: id) == .connected else { return nil }
    if metric == .heartRate {
      guard let reading = heartRateReadings[id],
        date.timeIntervalSince(reading.date) <= Self.heartRateMaxAge
      else { return nil }
      return reading.bpm
    }
    return cyclingReadings[id]?.reading(for: metric, at: date)
  }

  public func paired(_ kind: FitnessService) -> DiscoveredDevice? {
    paired.first { $0.kind == kind }
  }

  public func source(of metric: RideMetric) -> DiscoveredDevice? {
    let connected = connectedSensors(of: metric)
    if let pick = sourcePicks[metric],
      let device = connected.first(where: { $0.id == pick })
    {
      return device
    }
    return connected.first
  }

  public func sensors(of metric: RideMetric) -> [DiscoveredDevice] {
    var seen: Set<UUID> = []
    return metric.servicesBestFirst.flatMap { service in
      paired.filter { $0.services.contains(service) }
    }
    .filter { seen.insert($0.id).inserted }
  }

  public func connectedSensors(of metric: RideMetric) -> [DiscoveredDevice] {
    sensors(of: metric).filter { connectionState(of: $0.id) == .connected }
  }

  public func select(_ device: DiscoveredDevice, for metric: RideMetric) {
    guard sensors(of: metric).contains(where: { $0.id == device.id }) else { return }
    sourcePicks[metric] = device.id
    saveSourcePicks()
  }

  public func setTrainerTarget(_ target: TrainerTarget?, at date: Date = .now) {
    trainerTarget = target
    for id in trainerControls.keys {
      updateTrainerControl(id) { $0.set(target, at: date) }
    }
  }

  public func connectPaired() {
    guard !paired.isEmpty else { return }
    start()
  }

  public func pair(_ device: DiscoveredDevice) {
    guard device.isFitness else { return }
    for other in paired where other.id != device.id && other.kind == device.kind {
      forget(other.id)
    }
    if !isPaired(device.id) {
      paired.append(device)
      save()
    }
    if hasStarted {
      connect(device.id)
    } else {
      start()
    }
  }

  public func reconnect(_ id: UUID) {
    guard isPaired(id) else { return }
    connect(id)
  }

  public func forget(_ id: UUID) {
    guard isPaired(id) else { return }
    paired.removeAll { $0.id == id }
    save()
    sourcePicks = sourcePicks.filter { $0.value != id }
    saveSourcePicks()
    connections[id] = nil
    batteryLevels[id] = nil
    lastHeard[id] = nil
    cyclingReadings[id] = nil
    trainerControls[id] = nil
    heartRateReadings[id] = nil
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
    transport.scanAllDevices()
  }

  private func connect(_ id: UUID) {
    guard availability == .ready else { return }
    connections[id] = .connecting
    transport.connectWhenInRange(id)
  }

  private func isPaired(_ id: UUID) -> Bool { paired.contains { $0.id == id } }

  private func save() {
    defaults.set(try? JSONEncoder().encode(paired), forKey: Self.pairedKey)
  }

  private func saveSourcePicks() {
    defaults.set(try? JSONEncoder().encode(sourcePicks), forKey: Self.sourcePicksKey)
  }

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
      lastHeard.removeAll()
      cyclingReadings.removeAll()
      trainerControls.removeAll()
      heartRateReadings.removeAll()
      transport.stopScan()
    }
  }

  private func didConnect(_ id: UUID) {
    guard isPaired(id) else {
      transport.disconnect(id)
      return
    }
    connections[id] = .connected
    lastHeard[id] = .now
  }

  private func didDisconnect(_ id: UUID) {
    batteryLevels[id] = nil
    lastHeard[id] = nil
    cyclingReadings[id] = nil
    trainerControls[id] = nil
    heartRateReadings[id] = nil
    guard isPaired(id) else { return }
    connections[id] = .disconnected
    connect(id)
  }

  private func didFailToConnect(_ id: UUID) {
    guard isPaired(id) else { return }
    connections[id] = .disconnected
  }

  private func receive(_ measurement: HeartRateMeasurement, from id: UUID) {
    guard isPaired(id), connectionState(of: id) == .connected else { return }
    let bpm = measurement.reading
    heartRateReadings[id] = bpm.map { ($0, .now) }
    if bpm != nil { lastHeard[id] = .now }
    if let bpm, source(of: .heartRate)?.id == id { onHeartRate?(bpm) }
    startExpiringReadings()
  }

  func receiveCycling(
    _ data: Data, from id: UUID, characteristic: CyclingCharacteristic, at date: Date = .now
  ) {
    guard isPaired(id), connectionState(of: id) == .connected else { return }
    cyclingReadings[id, default: CyclingSensorReadings()].receive(
      data, from: characteristic, at: date)
    lastHeard[id] = date
    startExpiringReadings()
    onCyclingActivity?()
  }

  private func updateTrainerControl(
    _ id: UUID, _ change: (inout FitnessMachineControl) -> FitnessMachineCommand?
  ) {
    guard paired(.trainer)?.id == id, connectionState(of: id) == .connected else { return }
    var control = trainerControls[id] ?? FitnessMachineControl(target: trainerTarget)
    let command = change(&control)
    trainerControls[id] = control
    if let command { transport.writeTrainerControl(command.data, to: id) }
  }

  private func startExpiringReadings() {
    guard expiryTask == nil else { return }
    expiryTask = Task { [weak self] in
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(1)) } catch { break }
        guard let self else { break }
        for id in cyclingReadings.keys { cyclingReadings[id]?.expire(at: .now) }
        heartRateReadings = heartRateReadings.filter {
          Date.now.timeIntervalSince($0.value.date) <= Self.heartRateMaxAge
        }
        if cyclingReadings.isEmpty, heartRateReadings.isEmpty {
          expiryTask = nil
          break
        }
      }
    }
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
