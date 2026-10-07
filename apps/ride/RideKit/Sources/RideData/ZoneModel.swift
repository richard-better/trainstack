import Foundation

/// What a set of zones divides: heart rate in bpm or power in watts.
public enum ZoneMetric: String, CaseIterable, Sendable {
  case heartRate, power
}

/// A rider's threshold that zone models are calculated from.
public enum Threshold: CaseIterable, Sendable {
  case lactateThresholdHeartRate, maxHeartRate, restingHeartRate, ftp

  public var name: String {
    switch self {
    case .lactateThresholdHeartRate: "lactate threshold heart rate"
    case .maxHeartRate: "max heart rate"
    case .restingHeartRate: "resting heart rate"
    case .ftp: "FTP"
    }
  }

  public var abbreviation: String {
    switch self {
    case .lactateThresholdHeartRate: "LTHR"
    case .maxHeartRate: "max HR"
    case .restingHeartRate: "resting HR"
    case .ftp: "FTP"
    }
  }

  public var unit: String { self == .ftp ? "W" : "bpm" }
}

/// What a zone model's percentages are taken of.
public enum ZoneBasis: Sendable {
  case lactateThresholdHeartRate
  case maxHeartRate
  /// Heart rate reserve: resting heart rate plus a share of the range up to max (Karvonen).
  case heartRateReserve
  case ftp

  /// The thresholds a model with this basis needs.
  public var thresholds: [Threshold] {
    switch self {
    case .lactateThresholdHeartRate: [.lactateThresholdHeartRate]
    case .maxHeartRate: [.maxHeartRate]
    case .heartRateReserve: [.maxHeartRate, .restingHeartRate]
    case .ftp: [.ftp]
    }
  }

  /// The threshold that zone limits are shown as a percentage of.
  public var reference: Threshold {
    switch self {
    case .lactateThresholdHeartRate: .lactateThresholdHeartRate
    case .maxHeartRate, .heartRateReserve: .maxHeartRate
    case .ftp: .ftp
    }
  }
}

/// A published way of dividing heart rate or power into zones from a rider's thresholds.
public enum ZoneModel: String, CaseIterable, Codable, Sendable {
  case frielCycling, frielRunning, cogganHeartRate, percentOfMax, karvonen
  case coggan6, coggan7, polarized

  public struct Group: Sendable {
    public var title: String
    public var models: [ZoneModel]
  }

  /// The models for `metric`, grouped by the thresholds they need.
  public static func groups(for metric: ZoneMetric) -> [Group] {
    switch metric {
    case .heartRate:
      [
        Group(
          title: "From lactate threshold",
          models: [.frielCycling, .frielRunning, .cogganHeartRate]),
        Group(title: "From max heart rate", models: [.percentOfMax]),
        Group(title: "From max and resting heart rate", models: [.karvonen]),
      ]
    case .power:
      [Group(title: "From FTP", models: [.coggan6, .coggan7, .polarized])]
    }
  }

  /// The model used until the rider picks one.
  public static func standard(for metric: ZoneMetric) -> ZoneModel {
    switch metric {
    case .heartRate: .percentOfMax
    case .power: .coggan6
    }
  }

  public var metric: ZoneMetric {
    switch self {
    case .frielCycling, .frielRunning, .cogganHeartRate, .percentOfMax, .karvonen: .heartRate
    case .coggan6, .coggan7, .polarized: .power
    }
  }

  public var name: String {
    switch self {
    case .frielCycling: "Joe Friel for cycling"
    case .frielRunning: "Joe Friel for running"
    case .cogganHeartRate, .coggan6, .coggan7: "Andy Coggan"
    case .percentOfMax: "Percent of max"
    case .karvonen: "Karvonen"
    case .polarized: "Polarized"
    }
  }

  public var basis: ZoneBasis {
    switch self {
    case .frielCycling, .frielRunning, .cogganHeartRate: .lactateThresholdHeartRate
    case .percentOfMax: .maxHeartRate
    case .karvonen: .heartRateReserve
    case .coggan6, .coggan7, .polarized: .ftp
    }
  }

  /// The bottom of every zone after the first, in percent of the basis.
  ///
  /// Friel's tables are from his "Quick guide to setting zones", and Coggan's from "Training and
  /// Racing with a Power Meter".
  var lowerLimitPercents: [Int] {
    switch self {
    case .frielCycling: [81, 90, 94, 100, 103, 107]
    case .frielRunning: [85, 90, 95, 100, 103, 107]
    case .cogganHeartRate: [69, 84, 95, 106]
    case .percentOfMax, .karvonen: [60, 70, 80, 90]
    case .coggan6: [56, 76, 91, 106, 121]
    case .coggan7: [56, 76, 91, 106, 121, 151]
    case .polarized: [76, 101]
    }
  }

  public var zoneNames: [String] {
    switch self {
    case .frielCycling, .frielRunning:
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
    case .polarized: ["Easy", "Moderate", "Hard"]
    }
  }

  /// Zone numbers as their author writes them, such as 5a.
  public var zoneLabels: [String] {
    switch self {
    case .frielCycling, .frielRunning: ["1", "2", "3", "4", "5a", "5b", "5c"]
    default: zoneNames.indices.map { String($0 + 1) }
    }
  }

  public var zoneCount: Int { zoneNames.count }

  /// The top of every zone but the last, or nil when a threshold it needs is missing.
  public func upperLimits(for profile: RiderProfile) -> [Int]? {
    let limit: (Int) -> Int
    switch basis {
    case .lactateThresholdHeartRate:
      guard let threshold = profile.lactateThresholdHeartRate else { return nil }
      limit = { percent in Self.percent(percent, of: threshold) }
    case .maxHeartRate:
      guard let max = profile.maxHeartRate else { return nil }
      limit = { percent in Self.percent(percent, of: max) }
    case .heartRateReserve:
      guard let max = profile.maxHeartRate, let resting = profile.restingHeartRate else {
        return nil
      }
      limit = { percent in resting + Self.percent(percent, of: max - resting) }
    case .ftp:
      guard let ftp = profile.ftp else { return nil }
      limit = { percent in Self.percent(percent, of: ftp) }
    }
    // Each zone ends just below where the next one starts.
    return lowerLimitPercents.map { limit($0) - 1 }
  }

  private static func percent(_ percent: Int, of value: Int) -> Int {
    Int((Double(value) * Double(percent) / 100).rounded())
  }
}
