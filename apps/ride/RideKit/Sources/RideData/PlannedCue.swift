import Foundation

public struct PlannedCue: Hashable, Codable, Sendable {
  public var at: TimeInterval
  public var text: String
  public var shownFor: TimeInterval?

  public init(at: TimeInterval, text: String, shownFor: TimeInterval? = nil) {
    self.at = at
    self.text = text
    self.shownFor = shownFor
  }

  public static let defaultShownFor: TimeInterval = 10

  public func isShowing(atOffset offset: TimeInterval) -> Bool {
    offset >= at && offset < at + (shownFor ?? Self.defaultShownFor)
  }
}
