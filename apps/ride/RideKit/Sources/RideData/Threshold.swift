import Foundation

public enum Threshold: String, CaseIterable, Codable, CodingKeyRepresentable, Sendable {
  case lactateThresholdHeartRate, maxHeartRate, restingHeartRate
  case aerobicThresholdHeartRate
  case ftp
  case aerobicThresholdPower
  case thresholdPace

  public var wireName: String {
    switch self {
    case .lactateThresholdHeartRate: "lactate_threshold_heart_rate"
    case .maxHeartRate: "max_heart_rate"
    case .restingHeartRate: "resting_heart_rate"
    case .aerobicThresholdHeartRate: "aerobic_threshold_heart_rate"
    case .ftp: "ftp"
    case .aerobicThresholdPower: "aerobic_threshold_power"
    case .thresholdPace: "threshold_pace"
    }
  }

  public init?(wireName: String) {
    guard let threshold = Self.allCases.first(where: { $0.wireName == wireName }) else {
      return nil
    }
    self = threshold
  }

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

  public var metric: ZoneMetric {
    switch self {
    case .lactateThresholdHeartRate, .maxHeartRate, .restingHeartRate,
      .aerobicThresholdHeartRate:
      .heartRate
    case .ftp, .aerobicThresholdPower: .power
    case .thresholdPace: .pace
    }
  }

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
