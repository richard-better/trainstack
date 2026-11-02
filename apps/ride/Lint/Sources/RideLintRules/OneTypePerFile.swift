import SwiftSyntax

public struct OneTypePerFile: Rule {
  public static let name = "one-type-per-file"

  public func check(_ file: LintedFile) -> [Violation] {
    let types = file.tree.statements.compactMap { Self.typeName(of: $0.item) }
    guard types.count > 1 else { return [] }
    return types.dropFirst().map { name, node in
      file.violation(
        self, at: node,
        "\(name) is the second type in this file. Move it to \(name).swift.")
    }
  }

  private static func typeName(of item: CodeBlockItemSyntax.Item) -> (String, Syntax)? {
    guard case .decl(let decl) = item, !decl.isFilePrivate else { return nil }
    let name =
      decl.as(StructDeclSyntax.self)?.name ?? decl.as(ClassDeclSyntax.self)?.name
      ?? decl.as(EnumDeclSyntax.self)?.name ?? decl.as(ActorDeclSyntax.self)?.name
      ?? decl.as(ProtocolDeclSyntax.self)?.name
    return name.map { ($0.text, Syntax(decl)) }
  }
}

extension DeclSyntax {
  fileprivate var isFilePrivate: Bool {
    asProtocol(WithModifiersSyntax.self)?.modifiers.contains {
      $0.name.tokenKind == .keyword(.private) || $0.name.tokenKind == .keyword(.fileprivate)
    } ?? false
  }
}
