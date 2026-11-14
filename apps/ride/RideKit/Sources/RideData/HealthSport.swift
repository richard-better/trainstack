import Foundation

public enum HealthSport: String, CaseIterable, Sendable {
  case running, treadmillRunning, cycling, indoorCycling, walking, indoorWalking, hiking
  case poolSwimming, openWaterSwimming, swimming, rowing, indoorRowing, strength
  case climbing, indoorClimbing, crossCountrySkiing, alpineSkiing, snowboarding
  case elliptical, stairClimbing, yoga, pilates, hiit, other

  var fit: (sport: Int, subSport: Int) {
    typealias Sport = FITProfile.Sport
    typealias SubSport = FITProfile.SubSport
    return switch self {
    case .running: (Sport.running, SubSport.generic)
    case .treadmillRunning: (Sport.running, SubSport.treadmill)
    case .cycling: (Sport.cycling, SubSport.generic)
    case .indoorCycling: (Sport.cycling, SubSport.indoorCycling)
    case .walking: (Sport.walking, SubSport.generic)
    case .indoorWalking: (Sport.walking, SubSport.indoorWalking)
    case .hiking: (Sport.hiking, SubSport.generic)
    case .poolSwimming: (Sport.swimming, SubSport.lapSwimming)
    case .openWaterSwimming: (Sport.swimming, SubSport.openWater)
    case .swimming: (Sport.swimming, SubSport.generic)
    case .rowing: (Sport.rowing, SubSport.generic)
    case .indoorRowing: (Sport.rowing, SubSport.indoorRowing)
    case .strength: (Sport.training, SubSport.strengthTraining)
    case .climbing: (Sport.rockClimbing, SubSport.generic)
    case .indoorClimbing: (Sport.rockClimbing, SubSport.indoorClimbing)
    case .crossCountrySkiing: (Sport.crossCountrySkiing, SubSport.generic)
    case .alpineSkiing: (Sport.alpineSkiing, SubSport.generic)
    case .snowboarding: (Sport.snowboarding, SubSport.generic)
    case .elliptical: (Sport.fitnessEquipment, SubSport.elliptical)
    case .stairClimbing: (Sport.fitnessEquipment, SubSport.stairClimbing)
    case .yoga: (Sport.training, SubSport.yoga)
    case .pilates: (Sport.training, SubSport.pilates)
    case .hiit: (Sport.hiit, SubSport.generic)
    case .other: (Sport.generic, SubSport.generic)
    }
  }
}
