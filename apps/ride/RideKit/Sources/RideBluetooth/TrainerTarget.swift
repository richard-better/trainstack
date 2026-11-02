public enum TrainerTarget: Equatable, Sendable {
  case power(watts: Int)
  case grade(percent: Double)
  case resistance(shareOfRange: Double)
}
