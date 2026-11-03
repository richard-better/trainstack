import Foundation

struct BluetoothLogHeader: Codable, Equatable, Sendable {
  struct PairedDevice: Codable, Equatable, Sendable {
    var device: Int
    var services: Set<FitnessService>
  }

  var paired: [PairedDevice]
  var picks: [RideMetric: Int]
}
