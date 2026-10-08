import RideData

extension WorkoutTemplate {
  /// `60 min · 52 TSS · Threshold`.
  var summary: String { "\(shortSummary) · \(category.name)" }

  /// `60 min · 52 TSS`.
  var shortSummary: String { "\(Int((duration / 60).rounded())) min · \(stressScore) TSS" }
}
