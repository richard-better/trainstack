import Foundation

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

  var lowestIntensity: Double {
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

  public static func zone(intensity: Double) -> PowerZone {
    allCases.last { intensity >= $0.lowestIntensity } ?? .recovery
  }
}
