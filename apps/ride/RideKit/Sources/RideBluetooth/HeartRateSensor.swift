import Foundation
import Observation

/// A heart rate sensor the rider has chosen, remembered across launches.
public struct PairedSensor: Codable, Equatable, Sendable {
  public let id: UUID
  public var name: String
}

public enum SensorConnection: Sendable {
  /// Bluetooth is off or not yet ready.
  case waitingForBluetooth
  /// Waiting for the sensor to come into range.
  case connecting
  case connected
  /// The system refused the connection; `reconnect()` tries again.
  case failed
}

@MainActor
protocol HeartRateTransport: AnyObject {
  var onAvailability: ((BluetoothAvailability) -> Void)? { get set }
  var onConnect: ((UUID) -> Void)? { get set }
  /// An established connection dropped, such as when the sensor went out of range.
  var onDisconnect: ((UUID) -> Void)? { get set }
  /// A connection could not be made at all.
  var onFailure: ((UUID) -> Void)? { get set }
  var onMeasurement: ((UUID, HeartRateMeasurement) -> Void)? { get set }
  func start()
  func connect(_ id: UUID)
  func disconnect(_ id: UUID)
}

/// The connection to the rider's heart rate sensor. It reconnects whenever the sensor drops out,
/// and on launch, until the rider forgets the sensor.
@MainActor
@Observable
public final class HeartRateSensor {
  public private(set) var paired: PairedSensor?
  public private(set) var connection = SensorConnection.waitingForBluetooth
  /// The latest heart rate in beats per minute, or nil when there is no live reading.
  public private(set) var heartRate: Int?
  /// Called with each heart rate the sensor sends, so a ride can record every beat rather than
  /// only the latest.
  @ObservationIgnored public var onReading: ((Int) -> Void)?

  @ObservationIgnored private let transport: any HeartRateTransport
  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored private var availability = BluetoothAvailability.unknown
  private static let pairedKey = "pairedHeartRateSensor"

  public convenience init() { self.init(transport: CoreBluetoothHeartRate(), defaults: .standard) }

  init(transport: any HeartRateTransport, defaults: UserDefaults) {
    self.transport = transport
    self.defaults = defaults
    paired = defaults.data(forKey: Self.pairedKey)
      .flatMap { try? JSONDecoder().decode(PairedSensor.self, from: $0) }
    transport.onAvailability = { [weak self] in self?.updateAvailability($0) }
    transport.onConnect = { [weak self] in self?.didConnect($0) }
    transport.onDisconnect = { [weak self] in self?.didDisconnect($0) }
    transport.onFailure = { [weak self] in self?.didFail($0) }
    transport.onMeasurement = { [weak self] in self?.receive($1, from: $0) }
    // Bluetooth starts only once there is a sensor to connect to, so launch does not prompt.
    if paired != nil { transport.start() }
  }

  /// Connects to `device` from now on, in place of any sensor paired before.
  public func pair(_ device: DiscoveredDevice) {
    guard paired?.id != device.id else { return }
    if let paired { transport.disconnect(paired.id) }
    save(PairedSensor(id: device.id, name: device.displayName))
    transport.start()
    connect()
  }

  public func forget() {
    guard let paired else { return }
    transport.disconnect(paired.id)
    save(nil)
  }

  public func reconnect() {
    guard connection == .failed else { return }
    connect()
  }

  private func save(_ sensor: PairedSensor?) {
    paired = sensor
    heartRate = nil
    connection = .waitingForBluetooth
    defaults.set(sensor.flatMap { try? JSONEncoder().encode($0) }, forKey: Self.pairedKey)
  }

  private func connect() {
    guard let paired, availability == .ready else { return }
    connection = .connecting
    transport.connect(paired.id)
  }

  private func updateAvailability(_ state: BluetoothAvailability) {
    availability = state
    heartRate = nil
    connection = .waitingForBluetooth
    connect()
  }

  private func didConnect(_ id: UUID) {
    guard id == paired?.id else { return }
    connection = .connected
  }

  private func didDisconnect(_ id: UUID) {
    guard id == paired?.id else { return }
    heartRate = nil
    connect()
  }

  private func didFail(_ id: UUID) {
    guard id == paired?.id else { return }
    heartRate = nil
    connection = .failed
  }

  private func receive(_ measurement: HeartRateMeasurement, from id: UUID) {
    guard id == paired?.id, connection == .connected else { return }
    heartRate = measurement.reading
    if let heartRate { onReading?(heartRate) }
  }
}
