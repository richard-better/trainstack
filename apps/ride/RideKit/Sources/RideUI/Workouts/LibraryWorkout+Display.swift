import Foundation
import RideData
import RideStrava

extension LibraryWorkout {
  static let needsANewerRide =
    "It uses something this version of Ride does not know. Update Ride to ride it."

  var planned: PlannedWorkout? { rideability?.planned }

  var whyItCannotBeRidden: String? {
    guard let rideability else { return Self.needsANewerRide }
    return rideability.reason?.explanation
  }

  var zone: PowerZone? {
    focus.flatMap(TrainStackWorkout.Focus.init(rawValue:))?.powerZone
  }

  var duration: TimeInterval? {
    let total = workout?.flattened.reduce(0) { total, step -> TimeInterval? in
      guard let total, case .seconds(let seconds) = step.duration else { return nil }
      return total + seconds
    }
    return total.flatMap {
      $0 <= Double(TrainStackWorkout.mostSteps) * PlannedStep.longest ? $0 : nil
    }
  }

  func summary(ftp: Int?) -> String {
    var parts: [String] = []
    if let duration, duration > 0 { parts.append("\(Int((duration / 60).rounded())) min") }
    if let stress = planned?.stressScore(ftp: ftp) { parts.append("\(stress) TSS") }
    if let zone { parts.append(zone.name) }
    if planned == nil, sport != TrainStackWorkout.Sport.cycling.rawValue {
      parts.append(sport.capitalized)
    }
    return parts.joined(separator: " · ")
  }

  func matches(_ search: String) -> Bool {
    search.isEmpty || name.localizedStandardContains(search)
      || (description?.localizedStandardContains(search) ?? false)
  }
}
