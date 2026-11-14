import Foundation

public struct UntilLap: Hashable, Codable, Sendable {
  public var expectedSeconds: TimeInterval?
  public var expectedMeters: Double?

  public init(expectedSeconds: TimeInterval? = nil, expectedMeters: Double? = nil) {
    self.expectedSeconds = expectedSeconds
    self.expectedMeters = expectedMeters
  }
}
