import Foundation

enum SamplingRule {
  static let maxHeldGap: TimeInterval = 30

  static func pauses(from events: [TimerEvent]) -> [Range<TimeInterval>] {
    let ordered = events.enumerated().sorted {
      ($0.element.elapsed, $0.offset) < ($1.element.elapsed, $1.offset)
    }
    var pauses: [Range<TimeInterval>] = []
    var stoppedAt: TimeInterval?
    for event in ordered.map(\.element) {
      if event.stopsTheTimer {
        stoppedAt = stoppedAt ?? event.elapsed
      } else if let stopped = stoppedAt {
        if event.elapsed > stopped { pauses.append(stopped..<event.elapsed) }
        stoppedAt = nil
      }
    }
    if let stopped = stoppedAt { pauses.append(stopped..<TimeInterval.infinity) }
    return pauses
  }

  static func isPaused(_ elapsed: TimeInterval, by pauses: [Range<TimeInterval>]) -> Bool {
    pauses.contains { $0.lowerBound < elapsed && elapsed < $0.upperBound }
  }

  static func heldIntervals(
    of samples: [RideRecording.Sample], pauses: [Range<TimeInterval>]
  ) -> [HeldInterval] {
    var held: [HeldInterval] = []
    for index in samples.indices.dropLast() where !isPaused(samples[index].elapsed, by: pauses) {
      var from = samples[index].elapsed
      let to = samples[index + 1].elapsed
      let gap = to - from
      guard gap > 0, gap <= maxHeldGap else { continue }
      for pause in pauses where pause.upperBound > from && pause.lowerBound < to {
        if pause.lowerBound > from {
          held.append(HeldInterval(sample: index, start: from, end: pause.lowerBound))
        }
        from = max(from, pause.upperBound)
      }
      if to > from { held.append(HeldInterval(sample: index, start: from, end: to)) }
    }
    return held
  }
}
