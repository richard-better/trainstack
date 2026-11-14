import Foundation

struct HeldInterval: Equatable, Sendable {
  var sample: Int
  var start: TimeInterval
  var end: TimeInterval

  var duration: TimeInterval { end - start }
}
