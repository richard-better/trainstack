import Foundation
import RideBluetooth
import RideData

/// One source of a ride's readings as the player shows it: whether it is connected, and whether
/// it is still sending. Only the rider's paired devices are listed, and the watch once it has
/// sent heart rate during the ride.
struct SensorStatus: Equatable, Identifiable {
  enum Source: CaseIterable {
    case trainer, powerMeter, cadenceSensor, heartRateStrap, watch
  }

  enum Health: Equatable {
    /// Connected and reporting.
    case live
    /// Connected, but it has sent nothing for `quietAfter`, such as a strap that lost contact.
    case quiet
    /// Connecting, or reconnecting after it dropped.
    case connecting
    /// Not connected, and not trying until the rider asks.
    case disconnected
  }

  /// A paired device and what Bluetooth knows of it.
  struct Device {
    var device: DiscoveredDevice
    var connection: ConnectionState
    /// When it connected or last sent a reading.
    var lastHeard: Date?
    var batteryLevel: Int?
  }

  let source: Source
  let name: String
  let health: Health
  var batteryLevel: Int?

  var id: Source { source }

  /// How long a connected sensor can go without a reading before it shows as quiet. Sensors
  /// send at least once a second, and a ride stops using a reading after 5 seconds, so the
  /// warning comes as its number goes blank.
  static let quietAfter: TimeInterval = 5
  /// The watch sends less often, so it has as long as a ride keeps its heart rate.
  static let watchQuietAfter = HeartRateSelector.maxAge

  /// The status of each paired device, and of the watch if it has sent heart rate, in the
  /// order of `Source`.
  static func all(paired: [Device], watchLastHeard: Date?, at date: Date) -> [SensorStatus] {
    Source.allCases.compactMap { source in
      if source == .watch {
        return watchLastHeard.map {
          SensorStatus(
            source: .watch, name: HeartRateSource.watch.name,
            health: date.timeIntervalSince($0) <= watchQuietAfter ? .live : .quiet)
        }
      }
      return paired.first { $0.device.kind.map(Source.init) == source }.map {
        SensorStatus(
          source: source, name: $0.device.displayName,
          health: health(of: $0.connection, lastHeard: $0.lastHeard, at: date),
          batteryLevel: $0.batteryLevel)
      }
    }
  }

  static func health(of connection: ConnectionState, lastHeard: Date?, at date: Date) -> Health {
    switch connection {
    case .disconnected: .disconnected
    case .connecting: .connecting
    case .connected:
      lastHeard.map { date.timeIntervalSince($0) <= quietAfter } == true ? .live : .quiet
    }
  }
}

extension SensorStatus.Source {
  init(_ kind: FitnessService) {
    self =
      switch kind {
      case .trainer: .trainer
      case .power: .powerMeter
      case .speedAndCadence: .cadenceSensor
      case .heartRate: .heartRateStrap
      }
  }
}
