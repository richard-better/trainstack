import Foundation
import RideData

struct IntensityMonth: Identifiable {
  let start: Date
  let seconds: [Intensity: TimeInterval]
  var id: Date { start }
}
