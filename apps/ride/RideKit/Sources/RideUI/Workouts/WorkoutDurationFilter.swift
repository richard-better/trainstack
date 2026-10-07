import Foundation

enum WorkoutDurationFilter: CaseIterable {
  case any, short, medium, long

  var title: String {
    switch self {
    case .any: "Any duration"
    case .short: "Under 45 min"
    case .medium: "45–75 min"
    case .long: "Over 75 min"
    }
  }

  func includes(_ duration: TimeInterval) -> Bool {
    switch self {
    case .any: true
    case .short: duration < 45 * 60
    case .medium: (45 * 60...75 * 60).contains(duration)
    case .long: duration > 75 * 60
    }
  }
}
