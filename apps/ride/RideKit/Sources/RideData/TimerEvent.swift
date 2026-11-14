import Foundation

struct TimerEvent: Equatable, Sendable {
  var elapsed: TimeInterval
  var stopsTheTimer: Bool
}
