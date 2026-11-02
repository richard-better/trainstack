import Foundation

public struct ZoneChoice: Codable, Equatable, Sendable {
  public var model: ZoneModel
  public var customLimits: [Int]?

  public init(model: ZoneModel, customLimits: [Int]? = nil) {
    self.model = model
    self.customLimits = customLimits
  }

  public var isCustom: Bool { customLimits != nil }
}
