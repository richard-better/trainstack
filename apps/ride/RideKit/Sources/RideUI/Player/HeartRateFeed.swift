import Foundation
import RideData

final class HeartRateFeed {
  private var selector = HeartRateSelector()

  func record(_ bpm: Int, from source: HeartRateSource, at date: Date = .now) {
    selector.record(.init(bpm: bpm, source: source, date: date))
  }

  func current(at date: Date = .now) -> HeartRateSelector.Reading? {
    selector.current(at: date)
  }

  func latest(from source: HeartRateSource) -> HeartRateSelector.Reading? {
    selector.latest(from: source)
  }
}
