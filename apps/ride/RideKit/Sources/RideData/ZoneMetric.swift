import Foundation

public enum ZoneMetric: String, CaseIterable, Codable, Sendable {
  case heartRate, power, pace

  public var isDescending: Bool { self == .pace }
}
