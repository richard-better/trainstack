import Foundation
import RideBluetooth
import RideData

struct SensorStatus: Equatable, Identifiable {
  enum Source: CaseIterable {
    case trainer, powerMeter, cadenceSensor, heartRateStrap, watch
  }

  enum Health: Equatable {
    case live
    case quiet
    case connecting
    case disconnected
  }

  struct Device {
    var device: DiscoveredDevice
    var connection: ConnectionState
    var lastHeard: Date?
    var batteryLevel: Int?
  }

  let source: Source
  let name: String
  let health: Health
  var batteryLevel: Int?

  var id: Source { source }

  static let quietAfter: TimeInterval = 5
  static let watchQuietAfter = HeartRateSelector.maxAge

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
