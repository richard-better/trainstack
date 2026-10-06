import Charts
import RideData
import SwiftUI

/// Power and heart rate over the ride. Both share one unlabeled scale, so the chart shows
/// the shape of the effort rather than exact values; hover to read them.
struct ActivityChart: View {
  let recording: RideRecording
  @State private var selectedTime: Double?

  private enum Series: String {
    case power = "Power"
    case heartRate = "Heart rate"
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      legend
      Chart {
        ForEach(recording.samples, id: \.elapsed) { sample in
          if let power = sample.power {
            LineMark(
              x: .value("Time", sample.elapsed), y: .value("Value", power),
              series: .value("Series", Series.power.rawValue)
            )
            .foregroundStyle(by: .value("Series", Series.power.rawValue))
            .lineStyle(StrokeStyle(lineWidth: 1.2, lineJoin: .round))
          }
          if let heartRate = sample.heartRate {
            LineMark(
              x: .value("Time", sample.elapsed), y: .value("Value", heartRate),
              series: .value("Series", Series.heartRate.rawValue)
            )
            .foregroundStyle(by: .value("Series", Series.heartRate.rawValue))
            .lineStyle(StrokeStyle(lineWidth: 1.6, lineJoin: .round))
          }
        }
        if let selected {
          RuleMark(x: .value("Time", selected.elapsed))
            .foregroundStyle(.secondary.opacity(0.5))
            .annotation(
              position: .top, spacing: 4,
              overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
            ) {
              readout(for: selected)
            }
        }
      }
      .chartForegroundStyleScale([
        Series.power.rawValue: Color.primary.opacity(0.85),
        Series.heartRate.rawValue: Color.red,
      ])
      .chartLegend(.hidden)
      .chartXSelection(value: $selectedTime)
      .chartXScale(domain: 0...max(recording.summary.duration, 1))
      .chartYScale(domain: 0...yMaximum)
      .chartYAxis {
        AxisMarks(values: .automatic(desiredCount: 4)) { _ in
          AxisGridLine().foregroundStyle(.quaternary)
        }
      }
      .chartXAxis {
        AxisMarks(values: .stride(by: xStride)) { value in
          AxisGridLine().foregroundStyle(.quaternary)
          AxisValueLabel {
            if let seconds = value.as(Double.self) {
              Text(seconds.clockString).monospacedDigit()
            }
          }
        }
      }
      .frame(height: 220)
    }
  }

  private var legend: some View {
    HStack(spacing: 16) {
      if recording.hasPower { legendItem("Power", color: .primary.opacity(0.85), height: 2) }
      if recording.hasHeartRate { legendItem("Heart rate", color: .red, height: 2) }
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }

  private func legendItem(_ title: String, color: Color, height: CGFloat) -> some View {
    HStack(spacing: 6) {
      Rectangle().fill(color).frame(width: 12, height: height)
      Text(title)
    }
    .accessibilityElement(children: .combine)
  }

  private func readout(for sample: RideRecording.Sample) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(sample.elapsed.clockString).foregroundStyle(.secondary)
      if let power = sample.power { Text("\(power) W") }
      if let heartRate = sample.heartRate { Text("\(heartRate) bpm") }
    }
    .font(.caption.monospacedDigit())
    .padding(6)
    .background(.regularMaterial, in: .rect(cornerRadius: 6))
  }

  private var selected: RideRecording.Sample? {
    guard let selectedTime else { return nil }
    return recording.samples.min { abs($0.elapsed - selectedTime) < abs($1.elapsed - selectedTime) }
  }

  private var yMaximum: Double {
    let peak = recording.samples.lazy.flatMap { [$0.power, $0.heartRate].compactMap { $0 } }.max()
    return (Double(peak ?? 100) * 1.1 / 50).rounded(.up) * 50
  }

  /// A label every 5 minutes, spaced out for long rides so the axis stays readable.
  private var xStride: Double {
    let steps: [Double] = [300, 600, 900, 1800, 3600]
    return steps.first { recording.summary.duration / $0 <= 8 } ?? 3600
  }
}

#Preview {
  if let ride = try? RideRecording.sample() {
    ActivityChart(recording: ride).padding()
  }
}
