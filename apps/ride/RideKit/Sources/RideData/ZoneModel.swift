import Foundation

/// What a set of zones divides: heart rate in bpm, power in watts, or pace in seconds.
public enum ZoneMetric: String, CaseIterable, Codable, Sendable {
  case heartRate, power, pace

  /// Pace zones get harder as the number of seconds falls.
  public var isDescending: Bool { self == .pace }
}

/// A rider's threshold that zone models are calculated from.
public enum Threshold: String, CaseIterable, Codable, CodingKeyRepresentable, Sendable {
  case lactateThresholdHeartRate, maxHeartRate, restingHeartRate
  /// The heart rate at the first lactate or ventilatory threshold (LT1 or VT1).
  case aerobicThresholdHeartRate
  case ftp
  /// The power at the first lactate or ventilatory threshold (LT1 or VT1).
  case aerobicThresholdPower
  /// Seconds per kilometre for running, or per 100 metres for swimming (critical swim speed).
  case thresholdPace

  public var name: String {
    switch self {
    case .lactateThresholdHeartRate: "lactate threshold heart rate"
    case .maxHeartRate: "max heart rate"
    case .restingHeartRate: "resting heart rate"
    case .aerobicThresholdHeartRate: "aerobic threshold heart rate"
    case .ftp: "FTP"
    case .aerobicThresholdPower: "aerobic threshold power"
    case .thresholdPace: "threshold pace"
    }
  }

  public var abbreviation: String {
    switch self {
    case .lactateThresholdHeartRate: "LTHR"
    case .maxHeartRate: "max HR"
    case .restingHeartRate: "resting HR"
    case .aerobicThresholdHeartRate: "AeT HR"
    case .ftp: "FTP"
    case .aerobicThresholdPower: "AeT power"
    case .thresholdPace: "threshold pace"
    }
  }

  /// The metric whose zones this threshold sets.
  public var metric: ZoneMetric {
    switch self {
    case .lactateThresholdHeartRate, .maxHeartRate, .restingHeartRate,
      .aerobicThresholdHeartRate:
      .heartRate
    case .ftp, .aerobicThresholdPower: .power
    case .thresholdPace: .pace
    }
  }

  /// The values a threshold may take.
  public var range: ClosedRange<Int> {
    switch self {
    case .lactateThresholdHeartRate: 80...220
    case .maxHeartRate: 100...230
    case .restingHeartRate: 25...99
    case .aerobicThresholdHeartRate: 60...210
    case .ftp: 50...600
    case .aerobicThresholdPower: 30...500
    case .thresholdPace: 30...900
    }
  }
}
/// What a zone model's percentages are taken of.
public enum ZoneBasis: Sendable {
  case lactateThresholdHeartRate
  case maxHeartRate
  /// Heart rate reserve: resting heart rate plus a share of the range up to max (Karvonen).
  case heartRateReserve
  case ftp
  case thresholdPace
  /// Measured aerobic and lactate threshold heart rates, each the start of a zone.
  case heartRateThresholds
  /// Measured aerobic threshold power and FTP, each the start of a zone.
  case powerThresholds

  /// The thresholds a model with this basis needs.
  public var thresholds: [Threshold] {
    switch self {
    case .lactateThresholdHeartRate: [.lactateThresholdHeartRate]
    case .maxHeartRate: [.maxHeartRate]
    case .heartRateReserve: [.maxHeartRate, .restingHeartRate]
    case .ftp: [.ftp]
    case .thresholdPace: [.thresholdPace]
    case .heartRateThresholds: [.aerobicThresholdHeartRate, .lactateThresholdHeartRate]
    case .powerThresholds: [.aerobicThresholdPower, .ftp]
    }
  }

  /// The threshold that zone limits are shown as a percentage of.
  public var reference: Threshold {
    switch self {
    case .lactateThresholdHeartRate, .heartRateThresholds: .lactateThresholdHeartRate
    case .maxHeartRate, .heartRateReserve: .maxHeartRate
    case .ftp, .powerThresholds: .ftp
    case .thresholdPace: .thresholdPace
    }
  }
}

/// A published way of dividing heart rate, power or pace into zones from a rider's thresholds.
public enum ZoneModel: String, CaseIterable, Codable, Sendable {
  case frielCycling, frielRunning, cogganHeartRate, percentOfMax, karvonen
  case coggan6, coggan7, polarized
  case frielRunningPace, criticalSwimSpeed
  /// Seiler's three zones, split at measured aerobic and lactate thresholds.
  case seilerHeartRate, seilerPower

  public struct Group: Sendable {
    public var title: String
    public var models: [ZoneModel]
  }

  /// The models for `metric` in `sport`, or in any sport when nil, grouped by the thresholds
  /// they need.
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

  /// The model used until the rider picks one, or nil when `sport` has no zones for `metric`.
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

  /// Where every zone after the first starts, in percent of the basis. For pace, that is the
  /// zone's slowest pace. Empty for models whose zones start at measured thresholds.
  ///
  /// Friel's tables are from his "Quick guide to setting zones", Coggan's from "Training and
  /// Racing with a Power Meter", and the swim zones are the usual critical swim speed bands.
  var startPercents: [Int] {
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

  /// Whether time in each zone counts as easy, moderate or hard training.
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

  /// Zone numbers as their author writes them, such as 5a.
  public var zoneLabels: [String] {
    switch self {
    case .frielCycling, .frielRunning, .frielRunningPace: ["1", "2", "3", "4", "5a", "5b", "5c"]
    default: zoneNames.indices.map { String($0 + 1) }
    }
  }

  public var zoneCount: Int { zoneNames.count }

  /// The end of every zone but the last, from the thresholds in `thresholds`, or nil when one
  /// it needs is missing.
  public func limits(from thresholds: [Threshold: Int]) -> [Int]? {
    // Each zone ends one step short of where the next one starts.
    let step = metric.isDescending ? -1 : 1
    let start: (Int) -> Int
    switch basis {
    case .heartRateThresholds, .powerThresholds:
      let starts = basis.thresholds.compactMap { thresholds[$0] }
      return starts.count == basis.thresholds.count ? starts.map { $0 - step } : nil
    case .heartRateReserve:
      guard let max = thresholds[.maxHeartRate], let resting = thresholds[.restingHeartRate] else {
        return nil
      }
      start = { percent in resting + Self.percent(percent, of: max - resting) }
    default:
      guard let value = thresholds[basis.reference] else { return nil }
      start = { percent in Self.percent(percent, of: value) }
    }
    return startPercents.map { start($0) - step }
  }

  private static func percent(_ percent: Int, of value: Int) -> Int {
    Int((Double(value) * Double(percent) / 100).rounded())
  }
}
