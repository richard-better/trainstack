import Foundation
import RideData
import RideStrava

extension PlannedItem {
  var title: String {
    switch content {
    case .workout: workout?.name ?? "Workout"
    case .note(let title, _): title
    case .rest: "Rest day"
    case .unknown: "Something this version of Ride does not show"
    }
  }

  var symbol: String {
    switch content {
    case .workout:
      switch workout?.sport {
      case .running?: "figure.run"
      case .swimming?: "figure.pool.swim"
      default: "figure.indoor.cycle"
      }
    case .note: "note.text"
    case .rest: "bed.double"
    case .unknown: "questionmark.circle"
    }
  }

  var isRest: Bool {
    if case .rest = content { return true }
    return false
  }

  var playable: PlannedWorkout? { rideability?.planned }

  var canStart: Bool { playable != nil && state != .completed }

  var whyItCannotBeRidden: String? {
    guard isWorkout else { return nil }
    guard let rideability else { return LibraryWorkout.needsANewerRide }
    return rideability.reason?.explanation
  }

  var hasLapSteps: Bool {
    workout?.flattened.contains {
      guard case .untilLap = $0.duration else { return false }
      return true
    } == true
  }

  var summary: String {
    switch content {
    case .workout:
      var parts = [timeText, loadText]
      if let sport = workout?.sport, sport != .cycling { parts.append(sport.rawValue.capitalized) }
      return parts.joined(separator: " · ")
    case .note: return "Note"
    case .rest: return "Rest"
    case .unknown: return "Update Ride to see it."
    }
  }

  private var timeText: String {
    guard let seconds = planned?.seconds else {
      return hasLapSteps ? "Until you lap" : "Time unknown"
    }
    let laps = hasLapSteps ? " + laps" : ""
    return seconds.spokenString + laps
  }

  private var loadText: String {
    guard let load = planned?.load else { return "Load unknown" }
    return "\(Int(load.rounded())) TSS"
  }

  var stateLabel: String? {
    switch state {
    case .completed: "Done"
    case .skipped: skipped?.reason.map { "Skipped: \($0)" } ?? "Skipped"
    case .missed: "Missed"
    case .planned: nil
    }
  }
}
