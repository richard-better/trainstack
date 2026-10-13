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

  /// The metrics the sport can have zones for.
  public var metrics: [ZoneMetric] {
    switch self {
    case .cycling: [.heartRate, .power]
    case .running: [.heartRate, .power, .pace]
    case .swimming: [.heartRate, .pace]
    case .rowing: [.heartRate, .power]
    case .strength: [.heartRate]
    }
  }

  /// The distance pace is given for, in metres: per kilometre running, per 100 m swimming.
  public var paceDistance: Double? {
    switch self {
    case .running: 1000
    case .swimming: 100
    default: nil
    }
  }

  /// The FIT `sport` and `sub_sport` a ride of this sport is saved with. Cycling is a virtual
  /// activity, which Strava shows as a virtual ride, and indoor rowing names its sub-sport; the
  /// others use the generic one.
  var fitSport: (sport: Int, subSport: Int) {
    switch self {
    case .cycling: (2, 58)
    case .running: (1, 0)
    case .swimming: (5, 0)
    case .rowing: (15, 14)
    case .strength: (10, 20)
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
