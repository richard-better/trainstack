import Foundation
import RideData

/// A workout suggested on Today for one kind of day.
struct TodaySuggestion: Identifiable {
  /// The kind of day, such as `Easy day`. There is one suggestion of each kind.
  let tag: String
  let template: WorkoutTemplate
  var id: String { tag }

  /// The kinds of day, each with the workouts it takes turns suggesting.
  private static let kinds: [(tag: String, names: [String])] = [
    ("Fun pick", ["Pixel sprints 30", "Over-unders 2×10", "Zone 3 · 3×10"]),
    ("Easy day", ["Recovery 30", "Long endurance 90"]),
    ("Short and sharp", ["Ramp openers 30", "Tabata 4×40/20", "VO2 max booster"]),
  ]

  /// One workout of each kind of day, fitted to `minutes`. Each shuffle moves every kind on to
  /// its next workout.
  static func suggestions(minutes: Int, shuffle: Int) -> [TodaySuggestion] {
    kinds.compactMap { tag, names in
      let templates = names.compactMap(WorkoutTemplate.named)
      guard !templates.isEmpty else { return nil }
      let template = templates[shuffle % templates.count]
      return TodaySuggestion(tag: tag, template: template.fitted(to: TimeInterval(minutes * 60)))
    }
  }
}
