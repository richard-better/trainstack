import HealthKit
import RideData

extension HealthSport {
  init(
    _ type: HKWorkoutActivityType, indoor: Bool,
    swimmingLocation: HKWorkoutSwimmingLocationType = .unknown
  ) {
    self =
      switch type {
      case .running: indoor ? .treadmillRunning : .running
      case .cycling, .handCycling: indoor ? .indoorCycling : .cycling
      case .walking: indoor ? .indoorWalking : .walking
      case .hiking: .hiking
      case .swimming:
        switch swimmingLocation {
        case .pool: .poolSwimming
        case .openWater: .openWaterSwimming
        default: .swimming
        }
      case .rowing: indoor ? .indoorRowing : .rowing
      case .traditionalStrengthTraining, .functionalStrengthTraining: .strength
      case .climbing: indoor ? .indoorClimbing : .climbing
      case .crossCountrySkiing: .crossCountrySkiing
      case .downhillSkiing: .alpineSkiing
      case .snowboarding: .snowboarding
      case .elliptical: .elliptical
      case .stairClimbing, .stairs, .stepTraining: .stairClimbing
      case .yoga: .yoga
      case .pilates: .pilates
      case .highIntensityIntervalTraining: .hiit
      default: .other
      }
  }
}
