import Foundation

struct BluetoothLogEntry: Codable, Equatable, Sendable {
  enum Event: String, Codable, Sendable {
    case availability, connected, disconnected, connectFailed, battery, heartRate, cycling
    case trainerReady, trainer, target, write, tick
  }

  var time: Date
  var event: Event
  var device: Int?
  var characteristic: String?
  var bytes: Data?
  var availability: BluetoothAvailability?
  var target: TrainerTarget?

  private enum CodingKeys: String, CodingKey {
    case time = "t"
    case event = "e"
    case device = "d"
    case characteristic = "c"
    case bytes = "x"
    case availability = "a"
    case target
  }
}
