import Foundation
import RideStrava

extension CalendarActivity {
  var title: String {
    if let name, !name.isEmpty { return name }
    return sportName
  }

  var sportName: String {
    let sport = (sport ?? "activity").capitalized
    return indoor == true ? "Indoor \(sport.lowercased())" : sport
  }

  var symbol: String {
    switch sport {
    case "running": "figure.run"
    case "swimming": "figure.pool.swim"
    case "cycling": indoor == true ? "figure.indoor.cycle" : "figure.outdoor.cycle"
    default: "figure.mixed.cardio"
    }
  }

  var summary: String {
    var parts: [String] = []
    if let seconds { parts.append(CalendarFigures.hours(seconds)) }
    if let meters, meters > 0 { parts.append(CalendarFigures.distance(meters)) }
    if let load {
      parts.append("\(CalendarFigures.load(load)) TSS")
    } else if analysisDue {
      parts.append("Analysing")
    }
    return parts.joined(separator: " · ")
  }
}
