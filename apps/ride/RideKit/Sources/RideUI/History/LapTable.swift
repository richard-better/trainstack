import RideData
import SwiftUI

struct LapTable: View {
  let laps: [RideLap]

  var body: some View {
    Grid(alignment: .trailing, horizontalSpacing: 16, verticalSpacing: 8) {
      GridRow {
        Text("Lap").gridColumnAlignment(.leading)
        Text("Time")
        Text("Power")
        Text("Max")
        Text("Heart rate")
        Text("Cadence")
      }
      .font(.caption)
      .foregroundStyle(.secondary)
      Divider()
      ForEach(Array(laps.enumerated()), id: \.offset) { number, lap in
        GridRow {
          HStack(spacing: 4) {
            Text("\(number + 1)")
            if lap.trigger == .manual, laps.isMarkedMidStep(at: number) {
              Image(systemName: "flag.fill")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Marked by you")
            }
          }
          Text(lap.duration.clockString)
          Text(lap.averagePower.map { "\($0) W" } ?? "—")
          Text(lap.maxPower.map { "\($0) W" } ?? "—")
          Text(lap.averageHeartRate.map { "\($0) bpm" } ?? "—")
          Text(lap.averageCadence.map { "\($0) rpm" } ?? "—")
        }
        .accessibilityElement(children: .combine)
      }
    }
    .monospacedDigit()
    .lineLimit(1)
    .minimumScaleFactor(0.7)
  }
}

extension [RideLap] {
  fileprivate func isMarkedMidStep(at index: Int) -> Bool {
    guard indices.contains(index + 1), let step = self[index].stepIndex else { return false }
    return self[index + 1].stepIndex == step
  }
}

#Preview {
  LapTable(laps: [
    RideLap(start: 0, duration: 600, trigger: .time, stepIndex: 0, averagePower: 140),
    RideLap(start: 600, duration: 240, trigger: .manual, stepIndex: 1, averagePower: 250),
    RideLap(start: 840, duration: 360, trigger: .time, stepIndex: 1, averagePower: 245),
    RideLap(start: 1200, duration: 300, trigger: .sessionEnd, stepIndex: nil, averagePower: 120),
  ])
  .padding()
}
