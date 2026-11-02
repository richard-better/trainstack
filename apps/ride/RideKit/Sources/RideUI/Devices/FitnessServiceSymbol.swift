import RideBluetooth

extension FitnessService {
  var symbol: String {
    switch self {
    case .trainer: "bicycle"
    case .heartRate: "heart"
    case .power: "bolt"
    case .speedAndCadence: "gauge.with.needle"
    }
  }
}
