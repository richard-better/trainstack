import Foundation

public enum ZoneBasis: Sendable {
  case lactateThresholdHeartRate
  case maxHeartRate
  case heartRateReserve
  case ftp
  case thresholdPace
  case heartRateThresholds
  case powerThresholds

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

  public var reference: Threshold {
    switch self {
    case .lactateThresholdHeartRate, .heartRateThresholds: .lactateThresholdHeartRate
    case .maxHeartRate, .heartRateReserve: .maxHeartRate
    case .ftp, .powerThresholds: .ftp
    case .thresholdPace: .thresholdPace
    }
  }
}
