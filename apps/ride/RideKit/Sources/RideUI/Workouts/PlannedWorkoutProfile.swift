import RideData
import RideStyle
import SwiftUI

struct PlannedWorkoutProfile: View {
  let workout: PlannedWorkout
  let ftp: Int?
  static let untargetedShare = 0.4

  var body: some View {
    Canvas { context, size in
      let total = max(workout.duration, 1)
      let gap = 1.0
      let width = size.width - gap * Double(max(workout.steps.count - 1, 0))
      var x = 0.0
      for step in workout.steps {
        let stepWidth = max(width * step.duration / total, 0.5)
        let (from, to, color) = Self.shape(of: step, ftp: ftp)
        let top = { (share: Double) in
          size.height * (1 - min(share / WorkoutProfile.fullHeightIntensity, 1))
        }
        var path = Path()
        path.move(to: CGPoint(x: x, y: size.height))
        path.addLine(to: CGPoint(x: x, y: top(from)))
        path.addLine(to: CGPoint(x: x + stepWidth, y: top(to)))
        path.addLine(to: CGPoint(x: x + stepWidth, y: size.height))
        path.closeSubpath()
        context.fill(path, with: .color(color))
        x += stepWidth + gap
      }
    }
    .accessibilityHidden(true)
  }

  private static func shape(of step: PlannedStep, ftp: Int?) -> (Double, Double, Color) {
    if let share = step.shareOfFTP(ftp: ftp) {
      let zone = PowerZone.zone(intensity: (share.from + share.to) / 2)
      return (share.from, share.to, zone.color)
    }
    if case .maxEffort = step.target {
      return (
        WorkoutProfile.fullHeightIntensity, WorkoutProfile.fullHeightIntensity,
        PowerZone.anaerobic.color
      )
    }
    return (untargetedShare, untargetedShare, Color.secondary.opacity(0.4))
  }
}
