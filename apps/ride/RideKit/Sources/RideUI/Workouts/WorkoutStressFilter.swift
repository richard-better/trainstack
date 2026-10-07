enum WorkoutStressFilter: CaseIterable {
  case any, low, medium, high

  var title: String {
    switch self {
    case .any: "Any stress"
    case .low: "Under 40 TSS"
    case .medium: "40–70 TSS"
    case .high: "Over 70 TSS"
    }
  }

  func includes(_ stress: Int) -> Bool {
    switch self {
    case .any: true
    case .low: stress < 40
    case .medium: (40...70).contains(stress)
    case .high: stress > 70
    }
  }
}
