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
    let pause = firstPause(endingAfter: elapsed, in: pauses)
    return pause < pauses.count && pauses[pause].lowerBound < elapsed
  }

  static func heldIntervals(
    of samples: [RideRecording.Sample], pauses: [Range<TimeInterval>]
  ) -> [HeldInterval] {
    let paused = samples.map { isPaused($0.elapsed, by: pauses) }
    var held: [HeldInterval] = []
    var next = 0
    for index in samples.indices where !paused[index] {
      next = max(next, index + 1)
      while next < samples.count, paused[next] { next += 1 }
      guard next < samples.count else { break }
      let from = samples[index].elapsed
      let to = samples[next].elapsed
      let gap = to - from
      guard gap > 0, gap <= maxHeldGap else { continue }
      let pause = firstPause(endingAfter: from, in: pauses)
      let until = pause < pauses.count ? min(to, pauses[pause].lowerBound) : to
      if until > from { held.append(HeldInterval(sample: index, start: from, end: until)) }
    }
    return held
  }

  private static func firstPause(
    endingAfter elapsed: TimeInterval, in pauses: [Range<TimeInterval>]
  ) -> Int {
    var low = 0
    var high = pauses.count
    while low < high {
      let middle = (low + high) / 2
      if pauses[middle].upperBound <= elapsed { low = middle + 1 } else { high = middle }
    }
    return low
  }
}
