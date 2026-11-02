import SwiftSyntax

public struct KeychainStaysInItsStore: Rule {
  public static let name = "keychain-stays-in-its-store"

  static let store = "KeychainSessionStore"

  public func check(_ file: LintedFile) -> [Violation] {
    file.tree.descendants(DeclReferenceExprSyntax.self)
      .filter { $0.baseName.text.hasPrefix("SecItem") }
      .filter { $0.enclosingTypeNames.contains(Self.store) == false }
      .map {
        file.violation(
          self, at: $0,
          "Keychain calls can block launch on a prompt. Keep them in \(Self.store), which runs them off the main thread."
        )
      }
  }
}
