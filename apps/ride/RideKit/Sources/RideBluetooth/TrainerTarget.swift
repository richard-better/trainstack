/// What a ride asks a smart trainer to do.
public enum TrainerTarget: Equatable, Sendable {
  /// Holds this many watts whatever the cadence, in ERG mode.
  case power(Int)
  /// Rides like a road of this percent gradient.
  case grade(Double)
  /// A share of the trainer's resistance range, from 0 for the lightest to 1 for the hardest.
  case resistance(Double)
}
