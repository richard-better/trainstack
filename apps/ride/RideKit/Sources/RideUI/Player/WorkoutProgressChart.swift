import Charts
import RideData
import SwiftUI

/// The workout's intervals shaded as done, current and still to come, with power and heart
/// rate drawn over the part already ridden.
struct WorkoutProgressChart: View {
  let session: RideSession
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    Chart {
      ForEach(session.intervals) { interval in
        RectangleMark(
          xStart: .value("Start", interval.start), xEnd: .value("End", interval.end),
          yStart: .value("Floor", 0),
          yEnd: .value("Target", session.adjusted(interval.plannedPower))
        )
        .foregroundStyle(Color.primary.opacity(opacity(of: interval)))
      }
      ForEach(trace) { point in
        if let power = point.sample.power {
          LineMark(
            x: .value("Time", point.position), y: .value("Value", power),
            series: .value("Series", "Power \(point.run)")
          )
          .foregroundStyle(Color.primary.opacity(0.85))
          .lineStyle(StrokeStyle(lineWidth: 1.2, lineJoin: .round))
        }
        if let heartRate = point.sample.heartRate {
          LineMark(
            x: .value("Time", point.position), y: .value("Value", heartRate),
            series: .value("Series", "Heart rate \(point.run)")
          )
          .foregroundStyle(.red)
          .lineStyle(StrokeStyle(lineWidth: 1.6, lineJoin: .round))
        }
      }
      RuleMark(x: .value("Now", session.position))
        .foregroundStyle(Color.primary)
        .lineStyle(StrokeStyle(lineWidth: 1))
    }
    .chartXScale(domain: 0...max(session.duration, 1))
    .chartYScale(domain: 0...yMaximum)
    .chartYAxis {
      AxisMarks(values: .automatic(desiredCount: 4)) { _ in
        AxisGridLine().foregroundStyle(.quaternary)
      }
    }
    .chartXAxis {
      if !dynamicTypeSize.isAccessibilitySize {
        AxisMarks(values: .stride(by: xStride)) { value in
          AxisValueLabel {
            if let seconds = value.as(Double.self) {
              Text(seconds.clockString).monospacedDigit()
            }
          }
        }
      }
    }
    // Ideally as short as it can be, so the player only scrolls when even that doesn't fit.
    .frame(minHeight: 140, idealHeight: 140, maxHeight: 320)
    .accessibilityLabel("Workout progress")
    .accessibilityValue(
      "\(session.position.spokenString) of \(session.duration.spokenString) done")
  }

  /// Intervals already ridden are shaded darker than those to come, and the current one
  /// darker still.
  private func opacity(of interval: RideSession.Interval) -> Double {
    if interval.end <= session.position { return 0.16 }
    return interval.start <= session.position ? 0.32 : 0.08
  }

  /// The recorded samples, thinned to about one every few seconds on long rides so the chart
  /// stays quick to redraw every second.
  private var trace: [WorkoutTracePoint] {
    let samples = session.samples
    let stride = max(1, samples.count / 600)
    var points: [WorkoutTracePoint] = []
    var run = 0
    var previous: TimeInterval?
    for index in Swift.stride(from: 0, to: samples.count, by: stride) {
      let sample = samples[index]
      if let previous, sample.position - previous > Double(stride) * 2 + 1 { run += 1 }
      previous = sample.position
      points.append(.init(position: sample.position, sample: sample.sample, run: run))
    }
    return points
  }

  private var yMaximum: Double {
    let planned = session.intervals.map { session.adjusted($0.plannedPower) }.max() ?? 100
    let recorded = session.samples.lazy
      .flatMap { [$0.sample.power, $0.sample.heartRate].compactMap { $0 } }.max()
    let peak = max(Double(planned) * 1.4, Double(recorded ?? 0) * 1.05)
    return (peak / 50).rounded(.up) * 50
  }

  private var xStride: Double {
    let steps: [Double] = [300, 600, 900, 1800, 3600]
    return steps.first { session.duration / $0 <= 8 } ?? 3600
  }
}
