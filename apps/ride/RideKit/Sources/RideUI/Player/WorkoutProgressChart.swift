import Charts
import RideData
import SwiftUI

struct WorkoutProgressChart: View {
  let session: RideSession
  let ftp: Int?
  let heartRateZones: ZoneSet?
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let scale = scale
    let bars = bars
    let hasHeartRate = session.samples.contains { $0.sample.heartRate != nil }
    Chart {
      ForEach(bars) { bar in
        let shade = WorkoutTargetShade(
          interval: bar.interval, position: session.position, ftp: ftp)
        RectangleMark(
          xStart: .value("Start", bar.start), xEnd: .value("End", bar.end),
          yStart: .value("Floor", 0),
          yEnd: .value("Target", bar.watts.map(Double.init) ?? scale.powerMaximum)
        )
        .foregroundStyle(shade.color)
        if let range = bar.range {
          RectangleMark(
            xStart: .value("Start", bar.start), xEnd: .value("End", bar.end),
            yStart: .value("Low", range.lowerBound), yEnd: .value("High", range.upperBound)
          )
          .foregroundStyle(shade.color)
        }
      }
      if let ftp, scale.shows(watts: Double(ftp)) {
        RuleMark(y: .value("FTP", ftp))
          .foregroundStyle(Color.primary.opacity(0.45))
          .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
          .annotation(position: .top, alignment: .trailing, spacing: 2) {
            Text("FTP").font(.caption2).foregroundStyle(Color.secondary)
          }
      }
      ForEach(trace) { point in
        if let power = point.sample.power {
          LineMark(
            x: .value("Time", point.position), y: .value("Value", power),
            series: .value("Series", "Power \(point.unbrokenRun)")
          )
          .foregroundStyle(Color.primary.opacity(0.85))
          .lineStyle(StrokeStyle(lineWidth: 1.2, lineJoin: .round))
        }
        if let heartRate = point.sample.heartRate {
          LineMark(
            x: .value("Time", point.position),
            y: .value("Value", scale.watts(atHeartRate: Double(heartRate))),
            series: .value("Series", "Heart rate \(point.unbrokenRun)")
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
    .frame(minHeight: 140, idealHeight: 140, maxHeight: 320)
    .accessibilityLabel("Workout progress")
    .accessibilityValue(
      "\(session.position.spokenString) of \(session.duration.spokenString) done")
  }

  private var trace: [WorkoutTracePoint] { WorkoutTracePoint.trace(of: session.samples) }

  private var bars: [WorkoutTargetBar] { WorkoutTargetBar.bars(of: session) }

  private var scale: WorkoutChartScale {
    let planned =
      bars.compactMap { bar in [bar.watts, bar.range?.upperBound].compactMap(\.self).max() }.max()
      ?? 100
    let recorded = session.samples.compactMap(\.sample.power).max()
    return WorkoutChartScale(
      peakPower: max(Double(planned) * 1.4, Double(recorded ?? 0) * 1.05),
      heartRates: WorkoutChartScale.heartRateRange(
        recorded: session.samples.compactMap(\.sample.heartRate),
        zoneLimits: heartRateZones?.limits ?? []))
  }

  private func label(_ value: Int, unit: String, isTop: Bool) -> String {
    isTop ? "\(value) \(unit)" : "\(value)"
  }

  private var xStride: Double {
    let steps: [Double] = [300, 600, 900, 1800, 3600]
    return steps.first { session.duration / $0 <= 8 } ?? 3600
  }
}
