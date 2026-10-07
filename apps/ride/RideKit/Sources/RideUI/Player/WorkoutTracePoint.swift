import Foundation
import RideData

/// A point of the player's recorded trace, numbered by unbroken run so a skip leaves a gap in
/// the lines rather than a jump.
struct WorkoutTracePoint: Identifiable {
  let position: TimeInterval
  let sample: RideRecording.Sample
  let run: Int
  var id: TimeInterval { position }
}
