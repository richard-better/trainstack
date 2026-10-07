/// A reading a ride takes from its devices.
public enum RideMetric: CaseIterable, Sendable {
  case power, cadence, heartRate

  public var name: String {
    switch self {
    case .power: "Power"
    case .cadence: "Cadence"
    case .heartRate: "Heart rate"
    }
  }

  /// The services that supply the reading, best first: a dedicated sensor over a trainer.
  var sources: [FitnessService] {
    switch self {
    case .power: [.power, .trainer]
    case .cadence: [.speedAndCadence, .power, .trainer]
    case .heartRate: [.heartRate]
    }
  }
}
