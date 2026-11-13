import Foundation

public enum ZoneModel: String, CaseIterable, Codable, Sendable {
  case frielCycling, frielRunning, cogganHeartRate, percentOfMax, karvonen
  case coggan6, coggan7, polarized
  case frielRunningPace, criticalSwimSpeed
  case seilerHeartRate, seilerPower

  public var wireName: String {
    switch self {
    case .frielCycling: "friel_cycling"
    case .frielRunning: "friel_running"
    case .cogganHeartRate: "coggan_heart_rate"
    case .percentOfMax: "percent_of_max"
    case .karvonen: "karvonen"
    case .coggan6: "coggan_6"
    case .coggan7: "coggan_7"
    case .polarized: "polarized"
    case .frielRunningPace: "friel_running_pace"
    case .criticalSwimSpeed: "critical_swim_speed"
    case .seilerHeartRate: "seiler_heart_rate"
    case .seilerPower: "seiler_power"
    }
  }

  public init?(wireName: String) {
    guard let model = Self.allCases.first(where: { $0.wireName == wireName }) else { return nil }
    self = model
  }

  public struct Group: Sendable {
    public var title: String
    public var models: [ZoneModel]
  }

  public static func groups(for metric: ZoneMetric, in sport: Sport?) -> [Group] {
    switch metric {
    case .heartRate:
      [
        Group(
          title: "From lactate threshold",
          models: [.frielCycling, .frielRunning, .cogganHeartRate]),
        Group(title: "From max heart rate", models: [.percentOfMax]),
        Group(title: "From max and resting heart rate", models: [.karvonen]),
        Group(title: "From aerobic and lactate thresholds", models: [.seilerHeartRate]),
      ]
    case .power:
      [
        Group(title: "From FTP", models: [.coggan6, .coggan7, .polarized]),
        Group(title: "From aerobic threshold and FTP", models: [.seilerPower]),
      ]
    case .pace:
      switch sport {
      case .running: [Group(title: "From threshold pace", models: [.frielRunningPace])]
      case .swimming: [Group(title: "From critical swim speed", models: [.criticalSwimSpeed])]
      default: []
      }
    }
  }

  public static func standard(for metric: ZoneMetric, in sport: Sport?) -> ZoneModel? {
    switch metric {
    case .heartRate: .percentOfMax
    case .power: .coggan6
    case .pace: groups(for: .pace, in: sport).first?.models.first
    }
  }

  public var metric: ZoneMetric {
    switch self {
    case .frielCycling, .frielRunning, .cogganHeartRate, .percentOfMax, .karvonen,
      .seilerHeartRate:
      .heartRate
    case .coggan6, .coggan7, .polarized, .seilerPower: .power
    case .frielRunningPace, .criticalSwimSpeed: .pace
    }
  }

  public var name: String {
    switch self {
    case .frielCycling: "Joe Friel for cycling"
    case .frielRunning, .frielRunningPace: "Joe Friel for running"
    case .cogganHeartRate, .coggan6, .coggan7: "Andy Coggan"
    case .percentOfMax: "Percent of max"
    case .karvonen: "Karvonen"
    case .polarized: "Polarized"
    case .criticalSwimSpeed: "Critical swim speed"
    case .seilerHeartRate, .seilerPower: "Stephen Seiler"
    }
  }

  public var basis: ZoneBasis {
    switch self {
    case .frielCycling, .frielRunning, .cogganHeartRate: .lactateThresholdHeartRate
    case .percentOfMax: .maxHeartRate
    case .karvonen: .heartRateReserve
    case .coggan6, .coggan7, .polarized: .ftp
    case .frielRunningPace, .criticalSwimSpeed: .thresholdPace
    case .seilerHeartRate: .heartRateThresholds
    case .seilerPower: .powerThresholds
    }
  }

  var zoneStartPercentsOfBasis: [Int] {
    switch self {
    case .frielCycling: [81, 90, 94, 100, 103, 107]
    case .frielRunning: [85, 90, 95, 100, 103, 107]
    case .cogganHeartRate: [69, 84, 95, 106]
    case .percentOfMax, .karvonen: [60, 70, 80, 90]
    case .coggan6: [56, 76, 91, 106, 121]
    case .coggan7: [56, 76, 91, 106, 121, 151]
    case .polarized: [76, 101]
    case .frielRunningPace: [129, 113, 105, 100, 96, 90]
    case .criticalSwimSpeed: [110, 105, 100, 95]
    case .seilerHeartRate, .seilerPower: []
    }
  }

  public var zoneNames: [String] {
    switch self {
    case .frielCycling, .frielRunning, .frielRunningPace:
      [
        "Recovery", "Aerobic", "Tempo", "Subthreshold", "Superthreshold", "Aerobic capacity",
        "Anaerobic capacity",
      ]
    case .cogganHeartRate: ["Active recovery", "Endurance", "Tempo", "Threshold", "VO2 max"]
    case .percentOfMax, .karvonen: ["Recovery", "Aerobic", "Tempo", "Threshold", "VO2 max"]
    case .coggan6: ["Active recovery", "Endurance", "Tempo", "Threshold", "VO2 max", "Anaerobic"]
    case .coggan7:
      [
        "Active recovery", "Endurance", "Tempo", "Threshold", "VO2 max", "Anaerobic",
        "Neuromuscular",
      ]
    case .polarized, .seilerHeartRate, .seilerPower: ["Easy", "Moderate", "Hard"]
    case .criticalSwimSpeed: ["Aerobic", "Endurance", "Threshold", "VO2 max", "Sprint"]
    }
  }

  public var intensities: [Intensity] {
    switch self {
    case .frielCycling, .frielRunning, .frielRunningPace, .coggan7:
      [.easy, .easy, .moderate, .moderate, .hard, .hard, .hard]
    case .cogganHeartRate, .percentOfMax, .karvonen: [.easy, .easy, .moderate, .moderate, .hard]
    case .coggan6: [.easy, .easy, .moderate, .moderate, .hard, .hard]
    case .polarized, .seilerHeartRate, .seilerPower: [.easy, .moderate, .hard]
    case .criticalSwimSpeed: [.easy, .easy, .moderate, .hard, .hard]
    }
  }

  public var zoneLabels: [String] {
    switch self {
    case .frielCycling, .frielRunning, .frielRunningPace: ["1", "2", "3", "4", "5a", "5b", "5c"]
    default: zoneNames.indices.map { String($0 + 1) }
    }
  }

  public var zoneCount: Int { zoneNames.count }

  public func limits(from thresholds: [Threshold: Int]) -> [Int]? {
    let stepIntoNextZone = metric.isDescending ? -1 : 1
    let start: (Int) -> Int
    switch basis {
    case .heartRateThresholds, .powerThresholds:
      let starts = basis.thresholds.compactMap { thresholds[$0] }
      return starts.count == basis.thresholds.count ? starts.map { $0 - stepIntoNextZone } : nil
    case .heartRateReserve:
      guard let max = thresholds[.maxHeartRate], let resting = thresholds[.restingHeartRate] else {
        return nil
      }
      start = { percent in resting + Self.percent(percent, of: max - resting) }
    default:
      guard let value = thresholds[basis.reference] else { return nil }
      start = { percent in Self.percent(percent, of: value) }
    }
    return zoneStartPercentsOfBasis.map { start($0) - stepIntoNextZone }
  }

  private static func percent(_ percent: Int, of value: Int) -> Int {
    Int((Double(value) * Double(percent) / 100).rounded())
  }
}
