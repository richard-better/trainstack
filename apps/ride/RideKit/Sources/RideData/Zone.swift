import Foundation

public struct Zone: Hashable, Identifiable, Sendable {
  public var index: Int
  public var label: String
  public var name: String
  public var start: Int?
  public var end: Int?
  public var intensity: Intensity
  public var zoneCount: Int
}

extension Zone {
  public var id: Int { index }
}
