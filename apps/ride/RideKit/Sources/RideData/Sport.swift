import Foundation

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

  public var metrics: [ZoneMetric] {
    switch self {
    case .cycling: [.heartRate, .power]
    case .running: [.heartRate, .power, .pace]
    case .swimming: [.heartRate, .pace]
    case .rowing: [.heartRate, .power]
    case .strength: [.heartRate]
    }
  }

  public var paceDistanceMetres: Double? {
    switch self {
    case .running: 1000
    case .swimming: 100
    default: nil
    }
  }

  var fitSport: (sport: Int, subSport: Int) {
    typealias FITSport = FITProfile.Sport
    typealias FITSubSport = FITProfile.SubSport
    return switch self {
    case .cycling: (FITSport.cycling, FITSubSport.virtualActivity)
    case .running: (FITSport.running, FITSubSport.generic)
    case .swimming: (FITSport.swimming, FITSubSport.generic)
    case .rowing: (FITSport.rowing, FITSubSport.indoorRowing)
    case .strength: (FITSport.training, FITSubSport.strengthTraining)
    }
  }

  init?(fitSport: Int, subSport: Int?) {
    typealias FITSport = FITProfile.Sport
    switch fitSport {
    case FITSport.running: self = .running
    case FITSport.cycling: self = .cycling
    case FITSport.swimming: self = .swimming
    case FITSport.rowing: self = .rowing
    case FITSport.training where subSport == FITProfile.SubSport.strengthTraining:
      self = .strength
    default: return nil
    }
  }
}
