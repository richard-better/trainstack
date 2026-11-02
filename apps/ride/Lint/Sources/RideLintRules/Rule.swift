public protocol Rule: Sendable {
  static var name: String { get }
  func check(_ file: LintedFile) -> [Violation]
}
