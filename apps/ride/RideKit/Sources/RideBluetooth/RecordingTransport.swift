import Foundation

@MainActor
final class RecordingTransport: BluetoothTransport {
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

  private let inner: any BluetoothTransport
  private let now: () -> Date
  private var log: BluetoothLog?
  private var aliases: [UUID: Int] = [:]
  private var availability: Observation?
  private var observations = 0
  private var stateOfConnected: [UUID: [String: Observation]] = [:]
  private var recentMeasurements: [UUID: [Observation]] = [:]

  static let measurementHistory =
    CrankCadence.staleAfter + CrankCadence.stoppedAfter + CyclingSensorReadings.maxAge

  init(wrapping inner: any BluetoothTransport, now: @escaping () -> Date) {
    self.inner = inner
    self.now = now
    inner.onAvailability = { [weak self] state in
      self?.observe(.init(event: .availability, availability: state))
      self?.onAvailability?(state)
    }
    inner.onDiscovery = { [weak self] device in self?.onDiscovery?(device) }
    inner.onConnect = { [weak self] id in
      self?.observe(.init(event: .connected, device: id))
      self?.onConnect?(id)
    }
    inner.onDisconnect = { [weak self] id in
      self?.observe(.init(event: .disconnected, device: id))
      self?.onDisconnect?(id)
    }
    inner.onConnectFailure = { [weak self] id in
      self?.observe(.init(event: .connectFailed, device: id))
      self?.onConnectFailure?(id)
    }
    inner.onBatteryLevel = { [weak self] id, data in
      self?.observe(.init(event: .battery, device: id, bytes: data))
      self?.onBatteryLevel?(id, data)
    }
    inner.onHeartRateMeasurement = { [weak self] id, data in
      self?.observe(.init(event: .heartRate, device: id, bytes: data))
      self?.onHeartRateMeasurement?(id, data)
    }
    inner.onCyclingMeasurement = { [weak self] id, characteristic, data in
      self?.observe(
        .init(event: .cycling, device: id, characteristic: characteristic.rawValue, bytes: data))
      self?.onCyclingMeasurement?(id, characteristic, data)
    }
    inner.onTrainerControlReady = { [weak self] id in
      self?.observe(.init(event: .trainerReady, device: id))
      self?.onTrainerControlReady?(id)
    }
    inner.onTrainerValue = { [weak self] id, characteristic, data in
      self?.observe(
        .init(event: .trainer, device: id, characteristic: characteristic.rawValue, bytes: data))
      self?.onTrainerValue?(id, characteristic, data)
    }
  }

  func start() { inner.start() }
  func scanAllDevices() { inner.scanAllDevices() }
  func stopScan() { inner.stopScan() }
  func connectWhenInRange(_ id: UUID) { inner.connectWhenInRange(id) }
  func disconnect(_ id: UUID) { inner.disconnect(id) }

  func writeTrainerControl(_ data: Data, to id: UUID) {
    record(.init(event: .write, device: id, bytes: data), at: now())
    inner.writeTrainerControl(data, to: id)
  }

  func startRecording(
    to log: BluetoothLog, paired: [DiscoveredDevice], picks: [RideMetric: UUID]
  ) {
    self.log = log
    aliases = [:]
    log.write(
      BluetoothLogHeader(
        paired: paired.map { .init(device: alias(of: $0.id), services: $0.services) },
        picks: picks.mapValues(alias(of:))))
    let connected =
      (stateOfConnected.values.flatMap(\.values)
      + recentMeasurements.values.joined()).sorted { $0.order < $1.order }
    for observation in [availability].compactMap(\.self) + connected {
      record(observation.happening, at: observation.time)
    }
  }

  func stopRecording() {
    log?.close()
    log = nil
  }

  func recordTarget(_ target: TrainerTarget?, at date: Date) {
    record(.init(event: .target, target: target), at: date)
  }

  func recordPick(of id: UUID, for metric: RideMetric, at date: Date) {
    record(.init(event: .pick, device: id, metric: metric), at: date)
  }

  func recordTick(at date: Date) {
    record(.init(event: .tick), at: date)
  }

  private func observe(_ happening: Happening) {
    let time = now()
    observations += 1
    remember(Observation(happening: happening, time: time, order: observations))
    record(happening, at: time)
  }

  private func remember(_ observation: Observation) {
    let happening = observation.happening
    switch happening.event {
    case .availability:
      availability = observation
      if happening.availability != .ready {
        stateOfConnected = [:]
        recentMeasurements = [:]
      }
    case .connected:
      if let id = happening.device {
        stateOfConnected[id] = ["connected": observation]
        recentMeasurements[id] = nil
      }
    case .disconnected, .connectFailed:
      if let id = happening.device {
        stateOfConnected[id] = nil
        recentMeasurements[id] = nil
      }
    case .heartRate, .cycling:
      guard let id = happening.device, stateOfConnected[id] != nil else { return }
      let oldest = observation.time - Self.measurementHistory
      recentMeasurements[id, default: []].removeAll { $0.time < oldest }
      recentMeasurements[id]?.append(observation)
    case .trainer where happening.characteristic == TrainerCharacteristic.controlPoint.rawValue:
      break
    case .battery, .trainerReady, .trainer:
      guard let id = happening.device, stateOfConnected[id] != nil else { return }
      let key = [happening.event.rawValue, happening.characteristic].compactMap(\.self)
        .joined(separator: "/")
      stateOfConnected[id]?[key] = observation
    case .target, .pick, .write, .tick:
      break
    }
  }

  private func record(_ happening: Happening, at time: Date) {
    guard let log else { return }
    log.write(
      BluetoothLogEntry(
        time: time, event: happening.event, device: happening.device.map(alias(of:)),
        characteristic: happening.characteristic, bytes: happening.bytes,
        availability: happening.availability, target: happening.target, metric: happening.metric))
  }

  private func alias(of id: UUID) -> Int {
    if let alias = aliases[id] { return alias }
    let alias = aliases.count
    aliases[id] = alias
    return alias
  }
}

private struct Happening {
  var event: BluetoothLogEntry.Event
  var device: UUID?
  var characteristic: String?
  var bytes: Data?
  var availability: BluetoothAvailability?
  var target: TrainerTarget?
  var metric: RideMetric?
}

private struct Observation {
  var happening: Happening
  var time: Date
  var order: Int
}
