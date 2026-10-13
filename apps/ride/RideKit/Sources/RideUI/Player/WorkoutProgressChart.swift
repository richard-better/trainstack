import Charts
import RideData
import SwiftUI

/// The workout's intervals shaded as done, current and still to come, with power and heart
/// rate drawn over the part already ridden. Watts read off the leading axis and heart rate off
/// the trailing one.
struct WorkoutProgressChart: View {
  let session: RideSession
  /// The rider's heart rate zones, which steady the heart rate axis before much is recorded.
  let heartRateZones: ZoneSet?
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let scale = scale
    let hasHeartRate = session.samples.contains { $0.sample.heartRate != nil }
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
            x: .value("Time", point.position),
            y: .value("Value", scale.position(ofHeartRate: Double(heartRate))),
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
    .chartYScale(domain: 0...scale.powerMaximum)
    .chartYAxis {
      AxisMarks(position: .leading, values: scale.gridlines) { value in
        AxisGridLine().foregroundStyle(.quaternary)
        if !dynamicTypeSize.isAccessibilitySize, let watts = value.as(Double.self) {
          AxisValueLabel {
            Text(label(Int(watts), unit: "W", isTop: watts == scale.powerMaximum))
              .monospacedDigit()
          }
          .foregroundStyle(.secondary)
        }
      }
      if hasHeartRate, !dynamicTypeSize.isAccessibilitySize {
        AxisMarks(position: .trailing, values: scale.gridlines) { value in
          if let watts = value.as(Double.self) {
            let bpm = Int(scale.heartRate(at: watts).rounded())
            AxisValueLabel {
              Text(label(bpm, unit: "bpm", isTop: watts == scale.powerMaximum))
                .monospacedDigit()
            }
            .foregroundStyle(.red)
          }
        }
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

  /// Room above the hardest target and the highest power so far, with heart rate on the same
  /// gridlines.
  private var scale: WorkoutChartScale {
    let planned = session.intervals.map { session.adjusted($0.plannedPower) }.max() ?? 100
    let recorded = session.samples.compactMap(\.sample.power).max()
    return WorkoutChartScale(
      peakPower: max(Double(planned) * 1.4, Double(recorded ?? 0) * 1.05),
      heartRates: WorkoutChartScale.heartRateRange(
        recorded: session.samples.compactMap(\.sample.heartRate),
        zoneLimits: heartRateZones?.limits ?? []))
  }

  /// An axis value, with its unit on the top gridline only so the axis stays narrow.
  private func label(_ value: Int, unit: String, isTop: Bool) -> String {
    isTop ? "\(value) \(unit)" : "\(value)"
  }

  private var xStride: Double {
    let steps: [Double] = [300, 600, 900, 1800, 3600]
    return steps.first { session.duration / $0 <= 8 } ?? 3600
  }
}
