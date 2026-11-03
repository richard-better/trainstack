public enum TrainerTarget: Equatable, Codable, Sendable {
  case power(watts: Int)
  case grade(percent: Double)
  case resistance(shareOfRange: Double)
}
