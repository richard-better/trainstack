import Foundation
import RideData

struct WorkoutTargetBar: Equatable, Identifiable {
  let interval: RideSession.Interval
  let start: TimeInterval
  let end: TimeInterval
  let watts: Int?
  let range: ClosedRange<Int>?
  var slice = 0

  var id: [Int] { [interval.index, slice] }

  static let rampSliceSeconds: TimeInterval = 10

  static func bars(of session: RideSession) -> [WorkoutTargetBar] {
    session.intervals.flatMap { interval -> [WorkoutTargetBar] in
      let step = interval.step
      switch step.target {
      case .power(.ramp):
        let ridden = interval.end - interval.start
        let slices = max(1, Int((ridden / rampSliceSeconds).rounded()))
        let length = ridden / Double(slices)
        return (0..<slices).map { slice in
          let start = interval.start + Double(slice) * length
          return WorkoutTargetBar(
            interval: interval, start: start, end: start + length,
            watts: interval.plannedPower(at: start + length / 2).map(session.adjusted),
            range: nil, slice: slice)
        }
      case .power(.range(let low, let high)):
        return [
          WorkoutTargetBar(
            interval: interval, start: interval.start, end: interval.end,
            watts: interval.plannedPower(at: interval.start).map(session.adjusted),
            range: session.adjusted(Int(low.rounded()))...session.adjusted(Int(high.rounded())))
        ]
      default:
        return [
          WorkoutTargetBar(
            interval: interval, start: interval.start, end: interval.end,
            watts: interval.plannedPower(at: interval.start).map(session.adjusted), range: nil)
        ]
      }
    }
  }
}
