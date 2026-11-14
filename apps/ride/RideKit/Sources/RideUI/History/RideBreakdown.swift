import RideData

enum RideBreakdown: CaseIterable, Identifiable {
  case powerZones, heartRateZones, paceZones, powerCurve, laps

  var id: Self { self }

  var title: String {
    switch self {
    case .laps: "Laps"
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
    case .laps, .powerCurve: nil
    }
  }

  func isAvailable(for recording: RideRecording) -> Bool {
    switch self {
    case .laps: recording.laps.count > 1
    case .powerZones, .powerCurve: recording.hasPower
    case .heartRateZones: recording.hasHeartRate
    case .paceZones: recording.sport?.paceDistanceMetres != nil && recording.hasSpeed
    }
  }
}
