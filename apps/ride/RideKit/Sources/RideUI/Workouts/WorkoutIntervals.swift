import RideData
import RideStyle
import SwiftUI

/// A workout's sections as rows: the warm-up and cool-down as one ramp each, and each step of
/// a repeated set once, with the target in watts when there is an FTP.
struct WorkoutIntervals: View {
  let template: WorkoutTemplate
  let ftp: Int?

  var body: some View {
    ForEach(intervals.enumerated(), id: \.offset) { _, interval in
      WorkoutIntervalRow(
        color: interval.zone.color, repeats: interval.repeats, name: interval.name,
        detail: interval.detail, watts: interval.watts, duration: interval.duration.clockString)
    }
  }

  private struct Interval {
    var zone: PowerZone
    var repeats = ""
    var name: String
    var detail: String
    var watts: String?
    var duration: TimeInterval
  }

  private var intervals: [Interval] {
    template.sections.flatMap { section -> [Interval] in
      switch section.kind {
      case .warmUp: [ramp("Warm up", section, zone: section.steps[0].zone)]
      case .coolDown:
        [ramp("Cool down", section, zone: section.steps[section.steps.count - 1].zone)]
      case .effort, .recovery:
        section.steps.map { step(section.kind == .recovery ? "Recover" : $0.zone.name, $0) }
      case .repeats(let count):
        section.steps.enumerated().map { index, step in
          let isEasy = step.intensity < WorkoutTemplate.easyIntensity
          var interval = self.step(isEasy ? "Recover" : step.zone.name, step)
          if index == 0 { interval.repeats = "\(count)×" }
          if index >= section.steps.count - section.skippedInLastRepeat {
            interval.detail += " · not after the last set"
          }
          return interval
        }
      }
    }
  }

  private func step(_ name: String, _ step: WorkoutTemplate.Step) -> Interval {
    Interval(
      zone: step.zone, name: name, detail: "\(percent(step.intensity)) FTP",
      watts: watts(step.intensity).map { "\($0) W" }, duration: step.duration)
  }

  /// Easy steps that climb or fall as one line: `Ramp 45 → 72% FTP` at `108–173 W`.
  private func ramp(_ name: String, _ section: WorkoutSection, zone: PowerZone) -> Interval {
    let first = section.steps[0]
    let last = section.steps[section.steps.count - 1]
    var interval = step(name, first)
    interval.zone = zone
    interval.duration = section.duration
    if first.intensity != last.intensity {
      let start = Int((first.intensity * 100).rounded())
      interval.detail = "Ramp \(start) → \(percent(last.intensity)) FTP"
      let range = [first.intensity, last.intensity].sorted().compactMap(watts)
      interval.watts = range.count == 2 ? "\(range[0])–\(range[1]) W" : nil
    }
    return interval
  }

  private func percent(_ intensity: Double) -> String {
    intensity.formatted(.percent.precision(.fractionLength(0)))
  }

  private func watts(_ intensity: Double) -> Int? {
    ftp.map { Int((Double($0) * intensity).rounded()) }
  }
}
