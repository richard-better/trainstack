import Foundation
import RideData

extension ZoneMetric {
  /// `Heart rate`, for headings.
  var title: String {
    switch self {
    case .heartRate: "Heart rate"
    case .power: "Power"
    case .pace: "Pace"
    }
  }

  /// `heart rate`, for use within a sentence.
  var name: String { title.lowercased() }

  /// The unit values are shown in, such as `bpm` or `/km`.
  func unit(in sport: Sport?) -> String {
    switch self {
    case .heartRate: "bpm"
    case .power: "W"
    case .pace: sport == .swimming ? "/100 m" : "/km"
    }
  }

  /// A value as it is shown: a number, or minutes and seconds for pace.
  func format(_ value: Int) -> String {
    self == .pace ? PaceFormat().format(value) : "\(value)"
  }
}

extension Threshold {
  var title: String {
    switch self {
    case .lactateThresholdHeartRate: "Lactate threshold heart rate"
    case .maxHeartRate: "Max heart rate"
    case .restingHeartRate: "Resting heart rate"
    case .aerobicThresholdHeartRate: "Aerobic threshold heart rate"
    case .ftp: "Functional threshold power"
    case .aerobicThresholdPower: "Aerobic threshold power"
    case .thresholdPace: "Threshold pace"
    }
  }

  func help(in sport: Sport?) -> String {
    switch self {
    case .lactateThresholdHeartRate:
      "Your average over the last 20 minutes of an all-out 30-minute effort"
    case .maxHeartRate: "The highest your heart rate reaches in an all-out effort"
    case .restingHeartRate: "Measured lying down, just after you wake up"
    case .aerobicThresholdHeartRate:
      "Your first lactate or ventilatory threshold (LT1 or VT1), usually from a lab test"
    case .ftp: "The power you could hold for about an hour"
    case .aerobicThresholdPower:
      "Your power at the first lactate or ventilatory threshold (LT1 or VT1)"
    case .thresholdPace:
      sport == .swimming
        ? "Critical swim speed: half the difference between your 400 m and 200 m times"
        : "The pace you could hold for about an hour"
    }
  }
}

extension ZoneModel {
  var menuTitle: String { "\(name) · \(zoneCount) zones" }
}

extension ZoneScope {
  var title: String { sport?.name ?? "Default" }
}

extension ZoneChange {
  /// What the change did, such as `Default: FTP 220 W`.
  var summary: String {
    switch self {
    case .threshold(let threshold, let scope, let value):
      let shown = value.map {
        "\(threshold.metric.format($0)) \(threshold.metric.unit(in: scope.sport))"
      }
      return "\(scope.title): \(threshold.abbreviation) \(shown ?? "cleared")"
    case .choice(let metric, let scope, let choice):
      return choice.isCustom
        ? "\(scope.title): custom \(metric.name) zones, based on \(choice.model.menuTitle)"
        : "\(scope.title): \(metric.name) zones from \(choice.model.menuTitle)"
    case .ownZones(let metric, let sport, let isOwn):
      return isOwn
        ? "\(sport.name): own \(metric.name) zones"
        : "\(sport.name): uses Default \(metric.name) zones"
    case .listed(let sport, let isListed):
      return isListed ? "Added \(sport.name)" : "Removed \(sport.name)"
    }
  }
}
