import Foundation

struct WeeklyStress: Identifiable {
  let start: Date
  let averageDailyStress: Double
  var id: Date { start }
}
