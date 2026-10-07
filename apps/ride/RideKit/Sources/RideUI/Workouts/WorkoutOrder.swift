import Foundation
import RideData

enum WorkoutOrder: CaseIterable {
  case name, duration, stress

  var title: String {
    switch self {
    case .name: "Sort by Name"
    case .duration: "Sort by Duration"
    case .stress: "Sort by Stress"
    }
  }

  func areInIncreasingOrder(_ a: WorkoutTemplate, _ b: WorkoutTemplate) -> Bool {
    switch self {
    case .name: a.name.localizedStandardCompare(b.name) == .orderedAscending
    case .duration: (a.duration, a.name) < (b.duration, b.name)
    case .stress: (a.stressScore, a.name) < (b.stressScore, b.name)
    }
  }
}
