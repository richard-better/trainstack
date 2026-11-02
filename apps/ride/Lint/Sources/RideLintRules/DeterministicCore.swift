import SwiftSyntax

public struct DeterministicCore: Rule {
  public static let name = "deterministic-core"

  static let module = "RideCore"
  static let bannedTypes: Set<String> = [
    "ContinuousClock", "SuspendingClock", "SystemRandomNumberGenerator", "DispatchTime",
    "ProcessInfo", "CFAbsoluteTimeGetCurrent",
  ]
  static let bannedMembers: Set<String> = ["now", "random", "randomElement", "shuffled", "sleep"]
  static let bannedWhenCalledBare: Set<String> = ["Date", "UUID"]

  public func check(_ file: LintedFile) -> [Violation] {
    guard file.isInside(directory: Self.module) else { return [] }
    let types = file.tree.descendants(DeclReferenceExprSyntax.self)
      .filter { Self.bannedTypes.contains($0.baseName.text) }
      .map { Syntax($0) }
    let members = file.tree.descendants(MemberAccessExprSyntax.self)
      .filter { Self.bannedMembers.contains($0.declName.baseName.text) }
      .map { Syntax($0) }
    let bareCalls = file.tree.descendants(FunctionCallExprSyntax.self)
      .filter {
        $0.arguments.isEmpty && $0.trailingClosure == nil
          && Self.bannedWhenCalledBare.contains($0.calledExpression.trimmedDescription)
      }
      .map { Syntax($0) }
    return (types + members + bareCalls).sorted { $0.position < $1.position }.map {
      file.violation(
        self, at: $0,
        "\(Self.module) must replay a ride exactly from its inputs. Take times and randomness as inputs instead of reading \($0.trimmedDescription)."
      )
    }
  }
}
