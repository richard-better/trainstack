import Foundation
import RideData

/// A month of the intensity chart: the time spent at each intensity.
struct IntensityMonth: Identifiable {
  let start: Date
  let seconds: [Intensity: TimeInterval]
  var id: Date { start }
}
