enum ActivitySport {
  static func name(of slug: String?, indoor: Bool?) -> String {
    let sport = (slug ?? "activity").replacingOccurrences(of: "_", with: " ").capitalized
    let saysIndoor = indoor == true && ["cycling", "running", "rowing", "walking"].contains(slug)
    return saysIndoor ? "Indoor \(sport.lowercased())" : sport
  }

  static func symbol(of sport: String?, indoor: Bool?) -> String {
    switch sport {
    case "running": "figure.run"
    case "swimming": "figure.pool.swim"
    case "cycling": indoor == true ? "figure.indoor.cycle" : "figure.outdoor.cycle"
    case "walking": "figure.walk"
    case "hiking": "figure.hiking"
    case "rowing": "figure.rower"
    case "strength": "dumbbell"
    case "bouldering": "figure.climbing"
    default: "figure.mixed.cardio"
    }
  }
}
