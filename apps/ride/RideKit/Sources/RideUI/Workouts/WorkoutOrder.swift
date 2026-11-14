import Foundation
import RideData
import RideStrava

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

  func areInIncreasingOrder(_ a: LibraryWorkout, _ b: LibraryWorkout, ftp: Int?) -> Bool {
    let byName = a.name.localizedStandardCompare(b.name) == .orderedAscending
    switch self {
    case .name: return byName
    case .duration:
      let (x, y) = (a.duration ?? .infinity, b.duration ?? .infinity)
      return x == y ? byName : x < y
    case .stress:
      let (x, y) = (
        a.planned?.stressScore(ftp: ftp) ?? .max, b.planned?.stressScore(ftp: ftp) ?? .max
      )
      return x == y ? byName : x < y
    }
  }
}
