import Charts
import RideData
import SwiftUI

/// The best power held for each of a set of durations.
struct PowerCurveChart: View {
  let points: [PowerCurvePoint]

  var body: some View {
    // Durations are spaced evenly, since they are chosen to be readable rather than to scale.
    Chart(points) { point in
      LineMark(x: .value("Duration", point.duration.spokenString), y: .value("Power", point.power))
        .interpolationMethod(.monotone)
      PointMark(x: .value("Duration", point.duration.spokenString), y: .value("Power", point.power))
        .annotation(position: .top, spacing: 4) {
          Text("\(point.power) W").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
    }
    .foregroundStyle(.primary.opacity(0.85))
    .chartYScale(domain: .automatic(includesZero: false))
    .chartYAxis {
      AxisMarks(values: .automatic(desiredCount: 4)) { _ in
        AxisGridLine().foregroundStyle(.quaternary)
      }
    }
    .frame(height: 160)
    .padding(.top, 16)
  }
}
