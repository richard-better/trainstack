import Foundation

/// A week of the Progress trend.
struct WeeklyStress: Identifiable {
  let start: Date
  /// Average stress per day across the week, on the same scale as fitness.
  let dailyStress: Double
  var id: Date { start }
}
