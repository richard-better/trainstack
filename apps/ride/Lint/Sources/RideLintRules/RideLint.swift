public enum RideLint {
  public static let rules: [any Rule] = [
    NoComments(),
    OneTypePerFile(),
    EntryHoldsNoClosure(),
    NoGeometryReader(),
    KeychainStaysInItsStore(),
    DeterministicCore(),
  ]

  public static func lint(path: String, source: String) -> [Violation] {
    let file = LintedFile(path: path, source: source)
    return rules.flatMap { $0.check(file) }
  }
}
