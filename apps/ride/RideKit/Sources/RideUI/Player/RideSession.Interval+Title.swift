import RideData

extension RideSession.Interval {
  func title(ftp: Int) -> String {
    if let name = step.name { return name }
    return switch step.target {
    case .power: zone(ftp: ftp)?.name ?? "Power"
    case .heartRate: "Heart rate"
    case .maxEffort: "Max effort"
    case nil: "Free ride"
    }
  }
}
