import Foundation

public struct TemplateCue: Hashable, Codable, Sendable {
  public var step: Int
  public var at: TimeInterval
  public var text: String

  public init(step: Int, at: TimeInterval = 0, text: String) {
    self.step = step
    self.at = at
    self.text = text
  }

  static func cue(_ step: Int, at: TimeInterval = 0, _ text: String) -> TemplateCue {
    TemplateCue(step: step, at: at, text: text)
  }
}
