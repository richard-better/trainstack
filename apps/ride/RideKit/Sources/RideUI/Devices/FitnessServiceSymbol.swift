import RideBluetooth

extension FitnessService {
  /// The SF Symbol for a device of this kind.
  var symbol: String {
    switch self {
    case .trainer: "bicycle"
    case .heartRate: "heart"
    case .power: "bolt"
    case .speedAndCadence: "gauge.with.needle"
    }
  }
}
