public enum Intensity: Int, CaseIterable, Sendable {
  case easy, moderate, hard

  public var name: String {
    switch self {
    case .easy: "Easy"
    case .moderate: "Moderate"
    case .hard: "Hard"
    }
  }
}
