import RideData
import SwiftUI

/// How long and how hard a workout is: duration, stress, intensity factor and average power.
struct WorkoutStats: View {
  let template: WorkoutTemplate
  let ftp: Int?

  var body: some View {
    DividedRow(spacing: 0) {
      WorkoutStat(
        label: "Duration", value: "\(Int((template.duration / 60).rounded()))", unit: "min")
      WorkoutStat(label: "TSS", value: "\(template.stressScore)")
      WorkoutStat(
        label: "IF",
        value: template.intensityFactor.formatted(.number.precision(.fractionLength(2))))
      if let ftp {
        WorkoutStat(
          label: "Avg", value: "\(Int((Double(ftp) * template.averageIntensity).rounded()))",
          unit: "W")
      } else {
        WorkoutStat(
          label: "Avg",
          value: template.averageIntensity.formatted(.percent.precision(.fractionLength(0))))
      }
    }
    .monospacedDigit()
  }
}
