import Foundation

/// The six classic power bands, as fractions of FTP. Workouts are described by them, since a
/// workout's steps are set as a share of FTP rather than in a rider's own zones.
public enum PowerZone: Int, CaseIterable, Codable, Sendable {
  case recovery, endurance, tempo, threshold, vo2Max, anaerobic

  public var name: String {
    switch self {
    case .recovery: "Recovery"
    case .endurance: "Endurance"
    case .tempo: "Tempo"
    case .threshold: "Threshold"
    case .vo2Max: "VO2 max"
    case .anaerobic: "Anaerobic"
    }
  }

  /// Lower bound of the zone as a fraction of FTP.
  private var lowerBound: Double {
    switch self {
    case .recovery: 0
    case .endurance: 0.55
    case .tempo: 0.75
    case .threshold: 0.90
    case .vo2Max: 1.05
    case .anaerobic: 1.20
    }
  }

  public static func zone(power: Int, ftp: Int) -> PowerZone {
    zone(intensity: Double(power) / Double(ftp))
  }

  /// The zone of a power given as a fraction of FTP.
  public static func zone(intensity: Double) -> PowerZone {
    allCases.last { intensity >= $0.lowerBound } ?? .recovery
  }
}
