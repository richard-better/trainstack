import Foundation
import RideStrava

extension LoggedSummary {
  private static let poundsPerKilogram = 2.204_622_621_8

  func rowFigures(duration: TimeInterval?) -> [String] {
    var figures: [String] = []
    if let duration { figures.append(duration.clockString) }
    switch sport {
    case "strength":
      if let exercises { figures.append(exercises == 1 ? "1 exercise" : "\(exercises) exercises") }
      if let sets { figures.append(sets == 1 ? "1 set" : "\(sets) sets") }
    case "bouldering":
      if let problems { figures.append(problems == 1 ? "1 problem" : "\(problems) problems") }
      if let tops { figures.append(tops == 1 ? "1 top" : "\(tops) tops") }
    default: break
    }
    return figures
  }

  var volume: (value: Double, unit: String)? {
    guard let volumeKg else { return nil }
    return unit == "lb" ? (volumeKg * Self.poundsPerKilogram, "lb") : (volumeKg, "kg")
  }

  var stats: [RideStat] {
    var result: [RideStat] = []
    func count(_ label: String, _ value: Int?) {
      if let value { result.append(.init(label: label, value: "\(value)")) }
    }
    func grade(_ label: String, _ value: String?) {
      if let value { result.append(.init(label: label, value: value)) }
    }
    switch sport {
    case "strength":
      count("Exercises", exercises)
      count("Sets", sets)
      count("Reps", reps)
      if let volume {
        result.append(
          .init(
            label: "Volume", value: volume.value.formatted(.number.precision(.fractionLength(0))),
            unit: volume.unit))
      }
    case "bouldering":
      count("Problems", problems)
      count("Tops", tops)
      count("Flashes", flashes)
      count("Attempts", attempts)
      grade("Hardest top", hardestTop)
      grade("Hardest flash", hardestFlash)
    default: break
    }
    return result
  }
}
