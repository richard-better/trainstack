import Foundation
import RideStrava

extension CalendarActivity {
  var title: String {
    if let name, !name.isEmpty { return name }
    return sportName
  }

  var sportName: String { ActivitySport.name(of: sport, indoor: indoor) }

  var symbol: String { ActivitySport.symbol(of: sport, indoor: indoor) }

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
