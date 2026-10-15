import Foundation

/// What Ride on the phone and on the watch tell each other over the workout session the watch
/// mirrors to the phone.
public enum LinkMessage: Codable, Equatable, Sendable {
  /// From the phone: the ride as it stands.
  case glance(RideGlance)
  /// From the phone: the ride is over, so the watch ends its workout.
  case rideEnded
  /// From the phone: Ride on the phone or on a Mac records this ride and saves it to Health
  /// with its power and cadence, so the watch discards its workout rather than save another.
  case rideRecorded
  /// From the watch: the latest heart rate it measured.
  case heartRate(Int)

  public func encoded() throws -> Data {
    try PropertyListEncoder.binary.encode(self)
  }

  public init(data: Data) throws {
    self = try PropertyListDecoder().decode(Self.self, from: data)
  }
}

extension PropertyListEncoder {
  fileprivate static var binary: PropertyListEncoder {
    let encoder = PropertyListEncoder()
    encoder.outputFormat = .binary
    return encoder
  }
}
