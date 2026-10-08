import RideBluetooth

extension RideMetric {
  var symbol: String {
    switch self {
    case .power: "bolt"
    case .cadence: "arrow.clockwise"
    case .heartRate: "heart"
    }
  }
}
