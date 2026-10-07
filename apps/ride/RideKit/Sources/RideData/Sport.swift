import Foundation

/// A sport a rider can keep separate zones for.
public enum Sport: String, CaseIterable, Codable, Sendable {
  case cycling, running, swimming, rowing, strength

  public var name: String {
    switch self {
    case .cycling: "Cycling"
    case .running: "Running"
    case .swimming: "Swimming"
    case .rowing: "Rowing"
    case .strength: "Strength"
    }
  }

  /// The sport of a FIT session's `sport` and `sub_sport` fields, or nil for one Ride does not
  /// keep zones for.
  init?(fitSport: Int, subSport: Int?) {
    switch fitSport {
    case 1: self = .running
    case 2: self = .cycling
    case 5: self = .swimming
    case 15: self = .rowing
    // Training, with the strength training sub-sport.
    case 10 where subSport == 20: self = .strength
    default: return nil
    }
  }
}
