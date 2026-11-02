import Foundation

public struct ZoneShare: Equatable, Identifiable, Sendable {
  public var zone: Zone
  public var seconds: TimeInterval
  public var fraction: Double
}

extension ZoneShare {
  public var id: Zone { zone }
}
