import SwiftParser
import SwiftSyntax

public struct LintedFile {
  public let path: String
  public let tree: SourceFileSyntax
  private let locations: SourceLocationConverter

  public init(path: String, source: String) {
    self.path = path
    tree = Parser.parse(source: source)
    locations = SourceLocationConverter(fileName: path, tree: tree)
  }

  public var fileName: Substring {
    path.split(separator: "/").last ?? Substring(path)
  }

  public func isInside(directory: String) -> Bool {
    path.split(separator: "/").contains(Substring(directory))
  }

  func violation(_ rule: any Rule, at position: AbsolutePosition, _ message: String) -> Violation {
    let location = locations.location(for: position)
    return Violation(
      rule: type(of: rule).name, path: path, line: location.line, column: location.column,
      message: message)
  }

  func violation(_ rule: any Rule, at node: some SyntaxProtocol, _ message: String) -> Violation {
    violation(rule, at: node.positionAfterSkippingLeadingTrivia, message)
  }
}
