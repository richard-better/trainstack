import Foundation
import RideData

/// Heart rate from every source a ride can have, of which the ride takes the best: a chest
/// strap, then the watch.
final class HeartRateFeed {
  private var selector = HeartRateSelector()

  func record(_ bpm: Int, from source: HeartRateSource, at date: Date = .now) {
    selector.record(.init(bpm: bpm, source: source, date: date))
  }

  func current(at date: Date = .now) -> HeartRateSelector.Reading? {
    selector.current(at: date)
  }
}
