import SwiftSyntax

final class DescendantCollector<Node: SyntaxProtocol>: SyntaxAnyVisitor {
  private(set) var found: [Node] = []

  init() { super.init(viewMode: .sourceAccurate) }

  override func visitAny(_ node: Syntax) -> SyntaxVisitorContinueKind {
    if let match = node.as(Node.self) { found.append(match) }
    return .visitChildren
  }
}

extension SyntaxProtocol {
  func descendants<Node: SyntaxProtocol>(_ type: Node.Type) -> [Node] {
    let collector = DescendantCollector<Node>()
    collector.walk(self)
    return collector.found
  }

  var enclosingTypeNames: [String] {
    sequence(first: Syntax(self), next: \.parent).compactMap { node in
      if let named = node.asProtocol(NamedDeclSyntax.self), node.isProtocol(DeclGroupSyntax.self) {
        return named.name.text
      }
      return node.as(ExtensionDeclSyntax.self)?.extendedType.trimmedDescription
    }
  }
}

extension AttributeListSyntax {
  func contains(named name: String) -> Bool {
    contains { $0.as(AttributeSyntax.self)?.attributeName.trimmedDescription == name }
  }
}
