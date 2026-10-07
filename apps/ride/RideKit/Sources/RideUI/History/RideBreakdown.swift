import RideData

/// A way of breaking down a finished ride.
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

  /// The metric whose zones it shows, if it shows zones.
  var metric: ZoneMetric? {
    switch self {
    case .powerZones: .power
    case .heartRateZones: .heartRate
    case .paceZones: .pace
    case .powerCurve: nil
    }
  }

  /// Whether `recording` has the data it needs.
  func isAvailable(for recording: RideRecording) -> Bool {
    switch self {
    case .powerZones, .powerCurve: recording.hasPower
    case .heartRateZones: recording.hasHeartRate
    case .paceZones: recording.sport?.paceDistance != nil && recording.hasSpeed
    }
  }
}
