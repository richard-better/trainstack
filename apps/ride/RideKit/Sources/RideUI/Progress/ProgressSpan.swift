/// How far back the Progress trend looks.
enum ProgressSpan: CaseIterable {
  case sixWeeks, sixMonths, oneYear

  var title: String {
    switch self {
    case .sixWeeks: "6 weeks"
    case .sixMonths: "6 months"
    case .oneYear: "1 year"
    }
  }

  var days: Int {
    switch self {
    case .sixWeeks: 42
    case .sixMonths: 182
    case .oneYear: 365
    }
  }
}
