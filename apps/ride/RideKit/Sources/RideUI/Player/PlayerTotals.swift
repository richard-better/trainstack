import RideData
import SwiftUI

/// What the ride adds up to so far: average and normalized power, work, intensity, stress and
/// average heart rate. One row when it fits, otherwise two rows of three.
struct PlayerTotals: View {
  let totals: RideTotals
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let averagePower = SmallStat(
      label: "Avg power", value: totals.averagePower.map(String.init) ?? "-", unit: "W")
    let normalizedPower = SmallStat(
      label: "NP", value: totals.normalizedPower.map(String.init) ?? "-", unit: "W")
    let work = SmallStat(label: "Work", value: totals.work.map(String.init) ?? "-", unit: "kJ")
    let intensity = SmallStat(
      label: "IF",
      value: totals.intensityFactor?.formatted(.number.precision(.fractionLength(2))) ?? "-")
    let stress = SmallStat(label: "TSS", value: totals.stressScore.map(String.init) ?? "-")
    let heartRate = SmallStat(
      label: "Avg heart rate", value: totals.averageHeartRate.map(String.init) ?? "-",
      unit: "bpm")
    Group {
      if dynamicTypeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: 8) {
          averagePower
          normalizedPower
          work
          intensity
          stress
          heartRate
        }
      } else {
        ViewThatFits(in: .horizontal) {
          DividedRow {
            averagePower
            normalizedPower
            work
            intensity
            stress
            heartRate
          }
          Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
            GridRow {
              averagePower
              normalizedPower
              work
            }
            GridRow {
              intensity
              stress
              heartRate
            }
          }
        }
      }
    }
    .overlay(alignment: .bottom) { Divider() }
  }
}
