import Charts
import RideData
import SwiftUI

/// The workout being ridden. The whole workout is on screen as a chart, with the four numbers
/// a rider checks most underneath it, big enough to read from the saddle.
struct PlayerView: View {
  let controller: RideController
  var onEnd: () -> Void
  @State private var isConfirmingEnd = false

  private var session: RideSession { controller.session }

  var body: some View {
    VStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 8) {
        chartHeader
        WorkoutProgressChart(session: session)
          .overlay { if session.isPaused { pausedBadge } }
      }
      .padding(.horizontal, 24)
      .padding(.top, 16)
      .padding(.bottom, 8)
      controls
        .padding(.horizontal, 24)
        .frame(minHeight: 52)
      secondaryStats
        .padding(.horizontal, 24)
      primaryStats
        .padding(.horizontal, 24)
        .frame(maxHeight: .infinity)
    }
    .monospacedDigit()
    .navigationTitle(controller.template.name)
    .navigationSubtitle(subtitle)
    #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button("End Ride") { isConfirmingEnd = true }
      }
    }
    .confirmationDialog("End this ride?", isPresented: $isConfirmingEnd) {
      Button("End Ride", role: .destructive, action: onEnd)
      Button("Keep Riding", role: .cancel) {}
    } message: {
      Text("Rides aren't saved to History yet.")
    }
    .onAppear { controller.start() }
    .onDisappear { controller.stop() }
  }

  private var subtitle: String {
    "\(controller.template.category.name) · \(Int((session.duration / 60).rounded())) min"
  }

  // MARK: Chart

  private var chartHeader: some View {
    HStack {
      HStack(spacing: 16) {
        LegendSwatch(title: "Target", color: .primary.opacity(0.3), height: 10)
        LegendSwatch(title: "Power", color: .primary.opacity(0.85), height: 2)
        LegendSwatch(title: "Heart rate", color: .red, height: 2)
      }
      Spacer()
      Text(intervalLine)
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }

  private var intervalLine: String {
    guard let interval = session.currentInterval else { return "Workout complete" }
    return
      "Interval \(interval.index + 1) of \(session.intervals.count) · \(controller.zone(of: interval).name)"
  }

  private var pausedBadge: some View {
    Text(pausedMessage)
      .font(.headline)
      .padding(.horizontal, 16)
      .padding(.vertical, 8)
      .background(.regularMaterial, in: .rect(cornerRadius: 8))
  }

  private var pausedMessage: String {
    #if os(macOS)
      "Paused · press Space to resume"
    #else
      "Paused"
    #endif
  }

  // MARK: Controls

  private var controls: some View {
    HStack(spacing: 12) {
      Button(
        session.isPaused ? "Resume" : "Pause",
        systemImage: session.isPaused ? "play.fill" : "pause.fill", action: controller.togglePause
      )
      .labelStyle(.iconOnly)
      .keyboardShortcut(.space, modifiers: [])
      Button("Skip interval", systemImage: "forward.end.fill", action: controller.skipInterval)
        .buttonStyle(.borderless)
        .disabled(session.isComplete)
        .keyboardShortcut(.rightArrow, modifiers: .command)
        .help("Skip to the next interval (⌘→)")
      Spacer()
      Picker("Trainer mode", selection: modeBinding) {
        ForEach(TrainerMode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .fixedSize()
      SettingStepper(
        label: settingLabel, decrease: { controller.adjust(by: -1) },
        increase: { controller.adjust(by: 1) })
    }
  }

  private var modeBinding: Binding<TrainerMode> {
    Binding(get: { controller.mode }, set: { controller.mode = $0 })
  }

  private var settingLabel: String {
    switch session.mode {
    case .erg: "\(session.ergPercent)%"
    case .slope: "\(session.grade.formatted(.number.precision(.fractionLength(1))))%"
    case .level: "Level \(session.level)"
    }
  }

  // MARK: Numbers

  private var secondaryStats: some View {
    DividedRow {
      SmallStat(label: "Interval left", value: session.intervalRemaining?.clockString ?? "—")
      SmallStat(
        label: "Elapsed", value: session.elapsed.clockString,
        unit: "/ \(session.duration.clockString)")
      SmallStat(
        label: "Speed",
        value: session.latest.speed.map { ($0 * 3.6).formatted(.oneDecimal) } ?? "—",
        unit: "km/h")
      SmallStat(
        label: "Distance", value: (session.distance / 1000).formatted(.oneDecimal), unit: "km")
    }
    .overlay(alignment: .top) { Divider() }
    .overlay(alignment: .bottom) { Divider() }
  }

  private var primaryStats: some View {
    ViewThatFits(in: .horizontal) {
      DividedRow { bigNumbers }
        .frame(minWidth: 760)
      Grid(horizontalSpacing: 0, verticalSpacing: 16) {
        GridRow {
          targetNumber
          powerNumber
        }
        GridRow {
          cadenceNumber
          heartRateNumber
        }
      }
    }
  }

  @ViewBuilder private var bigNumbers: some View {
    targetNumber
    powerNumber
    cadenceNumber
    heartRateNumber
  }

  private var targetNumber: some View {
    BigStat(value: target.value, unit: target.unit) {
      HStack(spacing: 8) {
        Text("Target")
        if let interval = session.currentInterval {
          let zone = controller.zone(of: interval)
          Text("Z\(zone.rawValue + 1) \(zone.name)")
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 1)
            .background(.quaternary, in: .capsule)
        }
      }
    }
  }

  private var target: (value: String, unit: String) {
    switch session.mode {
    case .erg: (session.targetPower.map(String.init) ?? "—", "W")
    case .slope: (session.grade.formatted(.oneDecimal), "%")
    case .level: ("\(session.level)", "level")
    }
  }

  private var powerNumber: some View {
    BigStat(value: session.latest.power.map(String.init) ?? "—", unit: "W", detail: powerDetail) {
      LegendSwatch(title: "Power", color: .primary.opacity(0.85), height: 2)
    }
  }

  private var powerDetail: String {
    guard session.mode == .erg else { return "Free power in \(session.mode.rawValue)" }
    guard !session.isPaused, let target = session.targetPower, let power = session.latest.power
    else { return "" }
    let difference = power - target
    if abs(Double(difference)) <= Double(target) * 0.05 { return "On target" }
    return "\(difference > 0 ? "+" : "−")\(abs(difference)) W vs target"
  }

  private var cadenceNumber: some View {
    BigStat(value: session.latest.cadence.map(String.init) ?? "—", unit: "rpm") {
      Text("Cadence")
    }
  }

  private var heartRateNumber: some View {
    BigStat(value: session.latest.heartRate.map(String.init) ?? "—", unit: "bpm") {
      LegendSwatch(title: "Heart rate", color: .red, height: 2)
    }
  }
}

/// The workout's intervals shaded as done, current and still to come, with power and heart
/// rate drawn over the part already ridden.
private struct WorkoutProgressChart: View {
  let session: RideSession

  private enum Phase { case done, current, future }

  var body: some View {
    Chart {
      ForEach(session.intervals, id: \.index) { interval in
        RectangleMark(
          xStart: .value("Start", interval.start), xEnd: .value("End", interval.end),
          yStart: .value("Floor", 0),
          yEnd: .value("Target", session.adjusted(interval.plannedPower))
        )
        .foregroundStyle(Color.primary.opacity(opacity(of: phase(of: interval))))
      }
      ForEach(trace, id: \.position) { point in
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
      AxisMarks(values: .stride(by: xStride)) { value in
        AxisValueLabel {
          if let seconds = value.as(Double.self) {
            Text(seconds.clockString).monospacedDigit()
          }
        }
      }
    }
    .frame(minHeight: 180, idealHeight: 320, maxHeight: 320)
    .accessibilityLabel("Workout progress")
    .accessibilityValue(
      "\(session.position.spokenString) of \(session.duration.spokenString) done")
  }

  private func phase(of interval: RideSession.Interval) -> Phase {
    if interval.end <= session.position { return .done }
    return interval.start <= session.position ? .current : .future
  }

  private func opacity(of phase: Phase) -> Double {
    switch phase {
    case .done: 0.16
    case .current: 0.32
    case .future: 0.08
    }
  }

  /// A point of the recorded trace, numbered by unbroken run so a skip leaves a gap in the
  /// lines rather than a jump.
  private struct TracePoint {
    let position: TimeInterval
    let sample: RideRecording.Sample
    let run: Int
  }

  /// The recorded samples, thinned to about one every few seconds on long rides so the chart
  /// stays quick to redraw every second.
  private var trace: [TracePoint] {
    let samples = session.samples
    let stride = max(1, samples.count / 600)
    var points: [TracePoint] = []
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

private struct LegendSwatch: View {
  let title: String
  let color: Color
  let height: CGFloat

  var body: some View {
    HStack(spacing: 6) {
      RoundedRectangle(cornerRadius: height > 2 ? 2 : 0)
        .fill(color)
        .frame(width: height > 2 ? 10 : 12, height: height)
      Text(title)
    }
  }
}

/// − value +, for the setting of the current trainer mode. The arrow keys work too.
private struct SettingStepper: View {
  let label: String
  let decrease: () -> Void
  let increase: () -> Void

  var body: some View {
    HStack(spacing: 0) {
      Button("Decrease", systemImage: "minus", action: decrease)
        .keyboardShortcut(.downArrow, modifiers: [])
      Text(label)
        .fontWeight(.medium)
        .frame(minWidth: 64)
        .contentTransition(.numericText())
      Button("Increase", systemImage: "plus", action: increase)
        .keyboardShortcut(.upArrow, modifiers: [])
    }
    .labelStyle(.iconOnly)
    .buttonStyle(.borderless)
    .padding(.horizontal, 4)
    .frame(height: 26)
    .background(.quaternary.opacity(0.6), in: .rect(cornerRadius: 7))
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Trainer setting")
    .accessibilityValue(label)
    .accessibilityAdjustableAction { direction in
      switch direction {
      case .increment: increase()
      case .decrement: decrease()
      @unknown default: break
      }
    }
  }
}

private struct SmallStat: View {
  let label: String
  let value: String
  var unit: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(label).font(.caption).foregroundStyle(.secondary)
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text(value).font(.title2.weight(.medium))
        if let unit { Text(unit).font(.subheadline).foregroundStyle(.secondary) }
      }
      .lineLimit(1)
      .minimumScaleFactor(0.6)
    }
    .padding(.vertical, 12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}

private struct BigStat<Label: View>: View {
  let value: String
  let unit: String
  /// A line under the number. Every stat keeps room for one so the numbers line up.
  var detail = ""
  @ViewBuilder let label: Label

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      label.font(.subheadline).foregroundStyle(.secondary).frame(height: 20)
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text(value)
          .font(.system(size: 84, weight: .medium))
          .tracking(-1.5)
          .contentTransition(.numericText())
        Text(unit).font(.title3).foregroundStyle(.secondary)
      }
      .lineLimit(1)
      .minimumScaleFactor(0.4)
      Text(detail.isEmpty ? " " : detail).font(.caption).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}

/// Stats side by side, sharing the width, with a rule between each.
private struct DividedRow<Content: View>: View {
  @ViewBuilder let content: Content

  var body: some View {
    Group(subviews: content) { subviews in
      HStack(spacing: 0) {
        ForEach(Array(subviews.enumerated()), id: \.element.id) { index, subview in
          subview
            .padding(.leading, index == 0 ? 0 : 20)
            .overlay(alignment: .leading) {
              if index > 0 { Rectangle().fill(.separator).frame(width: 1) }
            }
        }
      }
    }
  }
}

extension FormatStyle where Self == FloatingPointFormatStyle<Double> {
  fileprivate static var oneDecimal: Self { .number.precision(.fractionLength(1)) }
}

#Preview("Riding") {
  NavigationStack {
    PlayerView(controller: .preview(.named("Threshold classic 60")!, minutes: 21)) {}
  }
  .frame(width: 1100, height: 760)
}

#Preview("Paused") {
  let controller = RideController.preview()
  controller.togglePause()
  return NavigationStack {
    PlayerView(controller: controller) {}
  }
  .frame(width: 800, height: 700)
}
