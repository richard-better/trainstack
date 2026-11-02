import Foundation

public enum LinkMessage: Codable, Equatable, Sendable {
  case glance(RideGlance)
  case rideEnded
  case rideRecorded
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
