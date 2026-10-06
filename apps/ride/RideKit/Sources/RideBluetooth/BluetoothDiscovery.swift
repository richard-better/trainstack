import Foundation
import Observation

public enum BluetoothAvailability: Sendable {
  case unknown, ready, poweredOff, unauthorized, unsupported, resetting
}

public enum FitnessService: String, CaseIterable, Sendable {
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

public struct DiscoveredDevice: Identifiable, Equatable, Sendable {
  public let id: UUID
  public var name: String?
  public var services: Set<FitnessService>

  public var displayName: String { name ?? "Unnamed device" }
  public var isFitness: Bool { !services.isEmpty }

  public init(id: UUID, name: String? = nil, services: Set<FitnessService> = []) {
    self.id = id
    self.name = name
    self.services = services
  }
}

@MainActor
protocol DiscoveryTransport: AnyObject {
  var onAvailability: ((BluetoothAvailability) -> Void)? { get set }
  var onDiscovery: ((DiscoveredDevice) -> Void)? { get set }
  func start()
  func scan()
  func stopScan()
}

@MainActor
@Observable
public final class BluetoothDiscovery {
  public private(set) var availability: BluetoothAvailability = .unknown
  public private(set) var isScanning = false
  /// Nearby devices that advertise at least one fitness service.
  public var fitnessDevices: [DiscoveredDevice] { sorted(discovered.values.filter(\.isFitness)) }
  /// Everything else in range, such as TVs, phones and headphones.
  public var otherDevices: [DiscoveredDevice] { sorted(discovered.values.filter { !$0.isFitness }) }

  private var discovered: [UUID: DiscoveredDevice] = [:]
  @ObservationIgnored private let transport: any DiscoveryTransport
  @ObservationIgnored private var wantsScan = false

  public convenience init() { self.init(transport: CoreBluetoothDiscovery()) }

  init(transport: any DiscoveryTransport) {
    self.transport = transport
    transport.onAvailability = { [weak self] state in self?.updateAvailability(state) }
    transport.onDiscovery = { [weak self] device in self?.receive(device) }
  }

  public func startScanning() {
    guard !wantsScan else { return }
    discovered.removeAll()
    wantsScan = true
    transport.start()
    if availability == .ready, !isScanning { scan() }
  }

  public func stopScanning() {
    wantsScan = false
    isScanning = false
    transport.stopScan()
  }

  private func scan() {
    guard !isScanning else { return }
    isScanning = true
    transport.scan()
  }

  private func updateAvailability(_ state: BluetoothAvailability) {
    availability = state
    if state == .ready {
      if wantsScan { scan() }
    } else {
      isScanning = false
      discovered.removeAll()
      transport.stopScan()
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
