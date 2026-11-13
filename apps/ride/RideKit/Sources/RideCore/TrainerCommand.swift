public enum TrainerCommand: Equatable, Sendable {
  case power(watts: Int)
  case grade(percent: Double)
  case resistance(shareOfRange: Double)
}
