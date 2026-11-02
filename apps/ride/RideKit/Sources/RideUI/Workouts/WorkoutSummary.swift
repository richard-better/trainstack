import RideData

extension WorkoutTemplate {
  var summary: String { "\(shortSummary) · \(category.name)" }

  var shortSummary: String { "\(Int((duration / 60).rounded())) min · \(stressScore) TSS" }
}
