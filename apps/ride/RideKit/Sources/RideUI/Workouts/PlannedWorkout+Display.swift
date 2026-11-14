import Foundation
import RideData

extension PlannedStep {
  func shareOfFTP(ftp: Int?) -> (from: Double, to: Double)? {
    switch target {
    case .shareOfFTP(let level): return Self.ends(of: level)
    case .watts(let level):
      guard let ftp, ftp > 0 else { return nil }
      return Self.ends(of: level.scaled(by: 1 / Double(ftp)))
    case .shareOfThresholdHeartRate, .beatsPerMinute, .maxEffort, nil: return nil
    }
  }

  private static func ends(of level: TargetLevel) -> (from: Double, to: Double) {
    switch level {
    case .constant(let value): (value, value)
    case .range(let low, let high): ((low + high) / 2, (low + high) / 2)
    case .ramp(let from, let to): (from, to)
    }
  }
}

extension PlannedWorkout {
  func stressScore(ftp: Int?) -> Int? {
    var hoursAtFTP = 0.0
    for step in steps {
      guard let share = step.shareOfFTP(ftp: ftp) else { return nil }
      let meanSquare =
        (share.from * share.from + share.from * share.to + share.to * share.to) / 3
      hoursAtFTP += step.duration * meanSquare / 3600
    }
    return Int((hoursAtFTP * 100).rounded())
  }
}
