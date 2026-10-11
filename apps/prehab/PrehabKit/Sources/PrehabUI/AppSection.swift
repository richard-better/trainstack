import Foundation

enum AppSection: String, CaseIterable, Identifiable {
  case today = "Today"
  case explore = "Explore"
  case coach = "Coach"
  case progress = "Progress"
  case profile = "Profile"
  var id: String { rawValue }
  var symbol: String {
    switch self {
    case .today: "sun.max"
    case .explore: "square.grid.2x2"
    case .coach: "bubble.left.and.bubble.right"
    case .progress: "chart.xyaxis.line"
    case .profile: "person.crop.circle"
    }
  }
}
