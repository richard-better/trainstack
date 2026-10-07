import Charts
import RideData
import SwiftUI

/// Power and heart rate over the ride. Both share one unlabeled scale, so the chart shows
/// the shape of the effort rather than exact values; hover to read them. Each entry in the
/// legend switches its series on and off.
struct ActivityChart: View {
  let recording: RideRecording
  @State private var selectedTime: Double?
  @State private var hidden: Set<Series> = []

  private enum Series: String, CaseIterable {
    case target = "Target"
    case power = "Power"
    case heartRate = "Heart rate"

    var color: Color {
      switch self {
      case .target: Color.primary.opacity(0.14)
      case .power: Color.primary.opacity(0.85)
      case .heartRate: .red
      }
    }

    /// Height of the legend swatch: a filled block for the target, a line for the others.
    var swatchHeight: CGFloat { self == .target ? 10 : 2 }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      legend
      Chart {
        if shows(.target) {
          ForEach(recording.targetSegments, id: \.start) { segment in
            RectangleMark(
              xStart: .value("Start", segment.start), xEnd: .value("End", segment.end),
              yStart: .value("Floor", 0), yEnd: .value("Target", segment.power)
            )
            .foregroundStyle(Series.target.color)
          }
        }
        ForEach(recording.samples, id: \.elapsed) { sample in
          if shows(.power), let power = sample.power {
            LineMark(
              x: .value("Time", sample.elapsed), y: .value("Value", power),
              series: .value("Series", Series.power.rawValue)
            )
            .foregroundStyle(by: .value("Series", Series.power.rawValue))
            .lineStyle(StrokeStyle(lineWidth: 1.2, lineJoin: .round))
          }
          if shows(.heartRate), let heartRate = sample.heartRate {
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
        Series.power.rawValue: Series.power.color,
        Series.heartRate.rawValue: Series.heartRate.color,
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
          withAnimation(.easeOut(duration: 0.15)) {
            if hidden.contains(series) { hidden.remove(series) } else { hidden.insert(series) }
          }
        }
      }
    }
    .font(.caption)
  }

  private var availableSeries: [Series] {
    Series.allCases.filter {
      switch $0 {
      case .target: recording.hasTarget
      case .power: recording.hasPower
      case .heartRate: recording.hasHeartRate
      }
    }
  }

  private func shows(_ series: Series) -> Bool { !hidden.contains(series) }

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
    .background(.regularMaterial, in: .rect(cornerRadius: 6))
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

/// A legend entry that switches its series on and off, and lights up under the pointer.
private struct LegendToggle: View {
  let title: String
  let color: Color
  let swatchHeight: CGFloat
  let isShown: Bool
  let action: () -> Void
  @State private var isHovering = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        Rectangle().fill(color).frame(width: 12, height: swatchHeight)
        Text(title).strikethrough(!isShown)
      }
      .foregroundStyle(isHovering ? .primary : .secondary)
      .opacity(isShown ? 1 : 0.45)
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(.quaternary.opacity(isHovering ? 1 : 0), in: .rect(cornerRadius: 6))
      .contentShape(.rect(cornerRadius: 6))
    }
    .buttonStyle(.plain)
    .onHover { isHovering = $0 }
    #if os(macOS)
      .pointerStyle(.link)
    #endif
    .help(isShown ? "Hide \(title.lowercased())" : "Show \(title.lowercased())")
    .accessibilityLabel(title)
    .accessibilityValue(isShown ? "Shown" : "Hidden")
    .accessibilityAddTraits(.isToggle)
  }
}

#Preview {
  if let ride = try? RideRecording.sample() {
    ActivityChart(recording: ride).padding()
  }
}
