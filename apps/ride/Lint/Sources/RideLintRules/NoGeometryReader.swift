import SwiftSyntax

public struct NoGeometryReader: Rule {
  public static let name = "no-geometry-reader"

  public func check(_ file: LintedFile) -> [Violation] {
    file.tree.descendants(DeclReferenceExprSyntax.self)
      .filter { $0.baseName.text == "GeometryReader" }
      .map {
        file.violation(
          self, at: $0,
          "GeometryReader takes all the space it is offered. Use a Layout, containerRelativeFrame or onGeometryChange."
        )
      }
  }
}
