import Charts
import RideData
import SwiftUI

/// Power and heart rate over the ride. Both share one unlabeled scale, so the chart shows
/// the shape of the effort rather than exact values; hover to read them. Each entry in the
/// legend switches its series on and off. With an FTP, each target step is tinted by its zone.
struct ActivityChart: View {
  let recording: RideRecording
  var ftp: Int?
  @State private var selectedTime: Double?
  @State private var hidden: Set<ActivityChartSeries> = []

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      legend
      Chart {
        if shows(.target) {
          ForEach(recording.targetSegments) { segment in
            RectangleMark(
              xStart: .value("Start", segment.start), xEnd: .value("End", segment.end),
              yStart: .value("Floor", 0), yEnd: .value("Target", segment.power)
            )
            .foregroundStyle(targetColor(segment.power))
          }
        }
        ForEach(recording.samples) { sample in
          if shows(.power), let power = sample.power {
            LineMark(
              x: .value("Time", sample.elapsed), y: .value("Value", power),
              series: .value("Series", ActivityChartSeries.power.rawValue)
            )
            .foregroundStyle(by: .value("Series", ActivityChartSeries.power.rawValue))
            .lineStyle(StrokeStyle(lineWidth: 1.2, lineJoin: .round))
          }
          if shows(.heartRate), let heartRate = sample.heartRate {
            LineMark(
              x: .value("Time", sample.elapsed), y: .value("Value", heartRate),
              series: .value("Series", ActivityChartSeries.heartRate.rawValue)
            )
            .foregroundStyle(by: .value("Series", ActivityChartSeries.heartRate.rawValue))
            .lineStyle(StrokeStyle(lineWidth: 1.6, lineJoin: .round))
          }
        }
        if let selected {
          RuleMark(x: .value("Time", selected.elapsed))
            .foregroundStyle(.secondary.opacity(0.5))
            .annotation(
              position: .top, spacing: 4,
              overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))
            ) {
              readout(for: selected)
            }
        }
      }
      .chartForegroundStyleScale([
        ActivityChartSeries.power.rawValue: ActivityChartSeries.power.color,
        ActivityChartSeries.heartRate.rawValue: ActivityChartSeries.heartRate.color,
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
    HStack(spacing: 4) {
      ForEach(availableSeries, id: \.self) { series in
        LegendToggle(
          title: series.rawValue, color: series.color, swatchHeight: series.swatchHeight,
          isShown: shows(series)
        ) {
          toggle(series)
        }
      }
    }
    .font(.caption)
  }

  private var availableSeries: [ActivityChartSeries] {
    ActivityChartSeries.allCases.filter {
      switch $0 {
      case .target: recording.hasTarget
      case .power: recording.hasPower
      case .heartRate: recording.hasHeartRate
      }
    }
  }

  /// The target step's zone colour, faint enough to read the lines over, or plain grey without
  /// an FTP to place it in a zone.
  private func targetColor(_ power: Int) -> Color {
    guard let ftp, ftp > 0 else { return ActivityChartSeries.target.color }
    return PowerZone.zone(power: power, ftp: ftp).color.opacity(0.3)
  }

  private func shows(_ series: ActivityChartSeries) -> Bool { !hidden.contains(series) }

  private func toggle(_ series: ActivityChartSeries) {
    withAnimation(.easeOut(duration: 0.15)) {
      if hidden.contains(series) { hidden.remove(series) } else { hidden.insert(series) }
    }
  }

  private func readout(for sample: RideRecording.Sample) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(sample.elapsed.clockString).foregroundStyle(.secondary)
      if shows(.power), let power = sample.power { Text("\(power) W") }
      if shows(.target), let target = sample.targetPower {
        Text("Target \(target) W").foregroundStyle(.secondary)
      }
      if shows(.heartRate), let heartRate = sample.heartRate { Text("\(heartRate) bpm") }
    }
    .font(.caption.monospacedDigit())
    .padding(6)
    .glassEffect(.regular, in: .rect(cornerRadius: 6))
  }

  private var selected: RideRecording.Sample? {
    guard let selectedTime else { return nil }
    return recording.samples.min { abs($0.elapsed - selectedTime) < abs($1.elapsed - selectedTime) }
  }

  private var yMaximum: Double {
    let peak = recording.samples.lazy
      .flatMap { [$0.power, $0.targetPower, $0.heartRate].compactMap { $0 } }.max()
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
    ActivityChart(recording: ride, ftp: 200).padding()
  }
}
