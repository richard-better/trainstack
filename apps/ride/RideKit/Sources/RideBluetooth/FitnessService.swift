public enum FitnessService: String, CaseIterable, Codable, Sendable {
  case trainer = "1826"
  case heartRate = "180D"
  case power = "1818"
  case speedAndCadence = "1816"

  static let mostCapableFirst: [FitnessService] = [.trainer, .power, .heartRate, .speedAndCadence]

  public var name: String {
    switch self {
    case .trainer: "Smart trainer"
    case .heartRate: "Heart rate"
    case .power: "Power meter"
    case .speedAndCadence: "Speed / cadence"
    }
  }
}
