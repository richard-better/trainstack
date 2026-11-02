@testable import RideLintRules

func violations(
  of rule: some Rule, in source: String, path: String = "RideKit/Sources/RideUI/Example.swift"
) -> [Violation] {
  rule.check(LintedFile(path: path, source: source))
}

func lines(_ violations: [Violation]) -> [Int] {
  violations.map(\.line)
}
