import Foundation

public struct TargetSegment: Equatable, Identifiable, Sendable {
  public var start: TimeInterval
  public var end: TimeInterval
  public var power: Int
}

extension TargetSegment {
  public var id: TimeInterval { start }
}
