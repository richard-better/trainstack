import Foundation
import RideData

struct TodaySuggestion: Identifiable {
  let kindOfDay: String
  let template: WorkoutTemplate
  var id: String { kindOfDay }

  private static let workoutsByKindOfDay: [(kindOfDay: String, names: [String])] = [
    ("Fun pick", ["Pixel sprints 30", "Over-unders 2×10", "Zone 3 · 3×10"]),
    ("Easy day", ["Recovery 30", "Long endurance 90"]),
    ("Short and sharp", ["Ramp openers 30", "Tabata 4×40/20", "VO2 max booster"]),
  ]

  static func suggestions(minutes: Int, shuffle: Int) -> [TodaySuggestion] {
    workoutsByKindOfDay.compactMap { kindOfDay, names in
      let templates = names.compactMap(WorkoutTemplate.named)
      guard !templates.isEmpty else { return nil }
      let template = templates[shuffle % templates.count]
      return TodaySuggestion(
        kindOfDay: kindOfDay, template: template.fitted(to: TimeInterval(minutes * 60)))
    }
  }
}
