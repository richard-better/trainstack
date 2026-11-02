public enum RideMetric: String, CaseIterable, Codable, CodingKeyRepresentable, Sendable {
  case power, cadence, heartRate

  public var name: String {
    switch self {
    case .power: "Power"
    case .cadence: "Cadence"
    case .heartRate: "Heart rate"
    }
  }

  var servicesBestFirst: [FitnessService] {
    switch self {
    case .power: [.power, .trainer]
    case .cadence: [.speedAndCadence, .power, .trainer]
    case .heartRate: [.heartRate]
    }
  }
}
