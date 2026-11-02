import RideData

enum RideBreakdown: CaseIterable, Identifiable {
  case powerZones, heartRateZones, paceZones, powerCurve

  var id: Self { self }

  var title: String {
    switch self {
    case .powerZones: "Power zones"
    case .heartRateZones: "Heart rate zones"
    case .paceZones: "Pace zones"
    case .powerCurve: "Power curve"
    }
  }

  var zoneMetric: ZoneMetric? {
    switch self {
    case .powerZones: .power
    case .heartRateZones: .heartRate
    case .paceZones: .pace
    case .powerCurve: nil
    }
  }

  func isAvailable(for recording: RideRecording) -> Bool {
    switch self {
    case .powerZones, .powerCurve: recording.hasPower
    case .heartRateZones: recording.hasHeartRate
    case .paceZones: recording.sport?.paceDistanceMetres != nil && recording.hasSpeed
    }
  }
}
