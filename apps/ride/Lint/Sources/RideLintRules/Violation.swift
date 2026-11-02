public struct Violation: Equatable, Sendable, CustomStringConvertible {
  public let rule: String
  public let path: String
  public let line: Int
  public let column: Int
  public let message: String

  public var description: String {
    "\(path):\(line):\(column): error: \(message) [\(rule)]"
  }
}
