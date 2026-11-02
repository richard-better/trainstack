import SwiftSyntax

public struct EntryHoldsNoClosure: Rule {
  public static let name = "entry-holds-no-closure"

  public func check(_ file: LintedFile) -> [Violation] {
    file.tree.descendants(VariableDeclSyntax.self)
      .filter { $0.attributes.contains(named: "Entry") }
      .flatMap(\.bindings)
      .filter(Self.holdsClosure)
      .map {
        file.violation(
          self, at: $0,
          "An @Entry closure is not Sendable. Wrap it in an action struct with callAsFunction, like OpenURLAction."
        )
      }
  }

  private static func holdsClosure(_ binding: PatternBindingSyntax) -> Bool {
    let typeIsFunction = binding.typeAnnotation.map { $0.type.isFunction } ?? false
    let valueIsClosure = binding.initializer?.value.is(ClosureExprSyntax.self) ?? false
    return typeIsFunction || valueIsClosure
  }
}

extension TypeSyntax {
  fileprivate var isFunction: Bool {
    if self.is(FunctionTypeSyntax.self) { return true }
    if let attributed = self.as(AttributedTypeSyntax.self) { return attributed.baseType.isFunction }
    if let optional = self.as(OptionalTypeSyntax.self) { return optional.wrappedType.isFunction }
    if let tuple = self.as(TupleTypeSyntax.self), tuple.elements.count == 1 {
      return tuple.elements.first!.type.isFunction
    }
    return false
  }
}
