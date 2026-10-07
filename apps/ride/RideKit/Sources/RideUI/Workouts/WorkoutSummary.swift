import RideData

extension WorkoutTemplate {
  /// `60 min · 52 TSS · Threshold`.
  var summary: String {
    "\(Int((duration / 60).rounded())) min · \(stressScore) TSS · \(category.name)"
  }
}
