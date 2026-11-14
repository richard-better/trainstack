import Foundation
import RideStrava

extension AccountActivity {
  var title: String {
    if let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
      return name
    }
    return sportName
  }

  var sportName: String { ActivitySport.name(of: sport ?? logged?.sport, indoor: indoor) }

  var symbol: String { ActivitySport.symbol(of: sport ?? logged?.sport, indoor: indoor) }

  var duration: TimeInterval? { statistics["timer_s"] ?? statistics["elapsed_s"] }

  var isSummarized: Bool { summarizedAt != nil || logged != nil || !statistics.isEmpty }

  var isRunOrWalk: Bool { ["running", "walking", "hiking"].contains(sport) }

  var rowFigures: [String] {
    if let logged { return logged.rowFigures(duration: duration) }
    var figures: [String] = []
    if let duration { figures.append(duration.clockString) }
    if let distance = statistics["distance_m"], distance > 0 {
      figures.append(CalendarFigures.distance(distance))
    }
    if let power = statistics["average_power_w"] { figures.append("\(Int(power.rounded())) W") }
    if let heartRate = statistics["average_heart_rate_bpm"] {
      figures.append("\(Int(heartRate.rounded())) bpm")
    }
    return figures
  }

  var stats: [RideStat] {
    var result: [RideStat] = []
    if let duration { result.append(.init(label: "Duration", value: duration.clockString)) }
    if let distance = statistics["distance_m"], distance > 0 {
      result.append(
        .init(
          label: "Distance",
          value: (distance / 1000).formatted(.number.precision(.fractionLength(1))), unit: "km"))
    }
    if let speed = statistics["average_speed_mps"], speed > 0, logged == nil {
      if isRunOrWalk {
        result.append(
          .init(
            label: "Avg pace", value: PaceFormat().format(Int((1000 / speed).rounded())),
            unit: "/km"))
      } else {
        result.append(
          .init(
            label: "Avg speed",
            value: (speed * 3.6).formatted(.number.precision(.fractionLength(1))), unit: "km/h"))
      }
    }
    if let power = statistics["average_power_w"] {
      result.append(.init(label: "Avg power", value: "\(Int(power.rounded()))", unit: "W"))
    }
    if let heartRate = statistics["average_heart_rate_bpm"] {
      result.append(
        .init(label: "Avg heart rate", value: "\(Int(heartRate.rounded()))", unit: "bpm"))
    }
    if let load = statistics["load_tss"] {
      result.append(.init(label: "Stress", value: CalendarFigures.load(load), unit: "TSS"))
    }
    if let ascent = statistics["ascent_m"], ascent > 0 {
      result.append(.init(label: "Ascent", value: "\(Int(ascent.rounded()))", unit: "m"))
    }
    if let calories = statistics["calories_kcal"], calories > 0 {
      result.append(.init(label: "Energy", value: "\(Int(calories.rounded()))", unit: "kcal"))
    }
    return result + (logged?.stats ?? [])
  }

  var zoneFractions: [Double] {
    for metric in ["power", "heart_rate"] {
      let prefix = "time_in_\(metric)_zone_"
      let zones = statistics.compactMap { key, seconds -> (label: String, seconds: Double)? in
        guard key.hasPrefix(prefix), key.hasSuffix("_s") else { return nil }
        return (String(key.dropFirst(prefix.count).dropLast(2)), seconds)
      }
      .sorted { $0.label.localizedStandardCompare($1.label) == .orderedAscending }
      let total = zones.reduce(0) { $0 + $1.seconds }
      if total > 0 { return zones.map { $0.seconds / total } }
    }
    return []
  }
}
