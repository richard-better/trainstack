public struct PlannedChanges: Equatable, Sendable {
  public var changed: Int
  public var cursor: String

  public init(changed: Int, cursor: String) {
    self.changed = changed
    self.cursor = cursor
  }
}
