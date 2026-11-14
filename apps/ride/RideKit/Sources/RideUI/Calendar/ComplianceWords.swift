import Foundation
import RideData
import RideStrava

struct ComplianceWords: Equatable {
  struct Part: Equatable, Identifiable {
    enum Key: String { case duration, distance, load, intervals }

    let key: Key
    let name: String
    let planned: String
    let done: String
    let verdict: String
    let score: Double

    var id: Key { key }
  }

  let score: Int?
  let rating: PlannedCompliance.Rating?
  let label: String
  let why: String
  let provisional: Bool
  let parts: [Part]
  let unscored: [String]

  init?(_ item: PlannedItem) {
    guard let compliance = item.compliance else { return nil }
    let given = compliance.parts
    let steps = item.workout?.flattened ?? []
    let hasLapStep = steps.contains {
      if case .untilLap = $0.duration { return true }
      return false
    }
    let hasDistanceSteps = steps.contains {
      if case .meters = $0.duration { return true }
      return false
    }
    var parts: [Part] = []
    if let duration = given.duration { parts.append(Self.line(.duration, duration)) }
    if let distance = given.distance { parts.append(Self.line(.distance, distance)) }
    if let load = given.load { parts.append(Self.line(.load, load)) }
    let intervals = given.intervals.flatMap(Self.line)
    if let intervals { parts.append(intervals) }

    var unscored: [String] = []
    if given.duration == nil, given.load == nil, hasLapStep {
      unscored.append(
        "Time, distance and load are not scored: a step lasts until you press lap, so how long it takes is yours to choose."
      )
    } else {
      if given.duration == nil {
        unscored.append("Time is not scored: the plan or the activity has no time.")
      }
      if given.distance == nil, hasDistanceSteps {
        unscored.append("Distance is not scored: the plan or the activity has no distance.")
      }
      if given.load == nil {
        unscored.append(
          "Load is not scored: the plan or the activity has no load, which needs your thresholds.")
      }
    }
    if intervals == nil { unscored.append(Self.intervalsUnscored(given.intervals, steps: steps)) }

    let weakest = parts.min { $0.score < $1.score }
    let why: String
    if compliance.score == nil {
      why = unscored.first ?? "Not scored."
    } else if let weakest, weakest.score < 1 {
      why =
        weakest.key == .intervals
        ? "Intervals pulled it down: \(weakest.verdict)."
        : "\(weakest.name) pulled it down: \(weakest.done) against \(weakest.planned) planned, \(weakest.verdict)."
    } else {
      why = "On target in every part that was scored."
    }

    score = compliance.score.map { Int($0.rounded()) }
    rating = compliance.rating
    label = compliance.rating.map(Self.words) ?? "Not scored"
    self.why = why
    provisional = compliance.pending
    self.parts = parts
    self.unscored = unscored
  }

  static func words(_ rating: PlannedCompliance.Rating) -> String {
    switch rating {
    case .onTarget: "On target"
    case .partly: "Partly"
    case .offTarget: "Off target"
    }
  }

  private static func offBy(_ ratio: Double) -> String {
    let percent = Int((abs(ratio - 1) * 100).rounded())
    if percent == 0 { return "as planned" }
    return "\(percent)% \(ratio > 1 ? "over" : "under")"
  }

  private static func line(_ key: Part.Key, _ part: PlannedCompliance.Part) -> Part {
    let format: (Double) -> String =
      switch key {
      case .duration: CalendarFigures.hours
      case .distance: CalendarFigures.distance
      default: CalendarFigures.load
      }
    let names: [Part.Key: String] = [.duration: "Time", .distance: "Distance", .load: "Load"]
    return Part(
      key: key, name: names[key] ?? "", planned: format(part.planned), done: format(part.done),
      verdict: offBy(part.ratio) + (part.score >= 1 ? ", within 20%" : ""), score: part.score)
  }

  private static func line(_ intervals: PlannedCompliance.Intervals) -> Part? {
    guard let share = intervals.share, let score = intervals.score else { return nil }
    return Part(
      key: .intervals, name: "Intervals", planned: CalendarFigures.hours(intervals.secondsWithData),
      done: CalendarFigures.hours(intervals.secondsInTarget),
      verdict: "\(Int((share * 100).rounded()))% of the time in target", score: score)
  }

  private static func intervalsUnscored(
    _ intervals: PlannedCompliance.Intervals?, steps: [TrainStackWorkout.Step]
  ) -> String {
    let targeted = steps.contains {
      guard let target = $0.target else { return false }
      if case .maxEffort = target { return false }
      return true
    }
    if !targeted {
      let allOut = steps.contains {
        if case .maxEffort? = $0.target { return true }
        return false
      }
      return allOut
        ? "Intervals are not scored: an all-out effort has no target band to hold."
        : "Intervals are not scored: the workout has no targets to hold."
    }
    if intervals == nil {
      return
        "Intervals are not scored: they need the activity's analysis, and for targets set against a threshold, that threshold in Settings."
    }
    return
      "Intervals are not scored: no step with a target had data, such as power targets on a ride without a power meter, or the steps could not be found in the activity."
  }
}
