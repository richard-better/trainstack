#if os(watchOS)
  import RideData
  import RideLink
  import RideStyle
  import SwiftUI

  /// The ride at a glance: time left in the interval, power against its target, and heart rate
  /// with its zone and source. Wrist down, it dims to what changes slowly: the minutes left, the
  /// target and the zone.
  struct GlanceView: View {
    let glance: RideGlance
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
      VStack(alignment: .leading, spacing: 4) {
        if let interval = glance.interval {
          Text(remaining(interval.remaining))
            .font(.system(size: 44, weight: isLuminanceReduced ? .medium : .semibold))
            .tracking(-1)
            .padding(.top, 4)
          if !isLuminanceReduced {
            IntervalProgress(progress: interval.progress, color: interval.zone.color)
          }
          power(in: interval)
            .padding(.top, isLuminanceReduced ? 16 : 8)
        } else {
          Text("Workout done")
            .font(.system(size: 20, weight: .semibold))
            .padding(.top, 4)
          Spacer(minLength: 0)
        }
        heartRate
        Spacer(minLength: 0)
        if !isLuminanceReduced, glance.heartRate != nil, let source = glance.heartRateSource {
          HeartRateSourceLabel(source: source)
        }
      }
      .lineLimit(1)
      .minimumScaleFactor(0.6)
      .monospacedDigit()
      .foregroundStyle(isLuminanceReduced ? .secondary : .primary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .screenTitle {
        IntervalTitle(glance: glance)
      }
    }

    /// Minutes and seconds, or wrist down only the minutes, such as `8:–`.
    private func remaining(_ seconds: TimeInterval) -> String {
      let clock = Duration.seconds(seconds.rounded(.up)).formatted(.time(pattern: .minuteSecond))
      guard isLuminanceReduced, let separator = clock.lastIndex(where: { !$0.isNumber }) else {
        return clock
      }
      return clock[...separator] + "–"
    }

    @ViewBuilder private func power(in interval: RideGlance.Interval) -> some View {
      let color = interval.zone.color.opacity(isLuminanceReduced ? 0.55 : 1)
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        if isLuminanceReduced {
          // The target holds for the whole interval, unlike live power.
          if let target = interval.targetPower {
            Text("\(target) W").font(.system(size: 30, weight: .medium)).foregroundStyle(color)
          }
        } else {
          Text(glance.power.map(String.init) ?? "--")
            .font(.system(size: 30, weight: .semibold))
            .foregroundStyle(color)
            .contentTransition(.numericText())
          Text(interval.targetPower.map { "/ \($0) W" } ?? "W")
            .font(.system(size: 14))
            .foregroundStyle(.secondary)
        }
      }
    }

    @ViewBuilder private var heartRate: some View {
      if isLuminanceReduced {
        if let zone = glance.heartRateZone {
          Text("Z\(zone.label)")
            .font(.system(size: 30, weight: .medium))
            .foregroundStyle(.pink.opacity(0.6))
        }
      } else if let bpm = glance.heartRate {
        HStack(spacing: 6) {
          Text("\(bpm)")
            .font(.system(size: 30, weight: .semibold))
            .foregroundStyle(.pink)
            .contentTransition(.numericText())
          if let zone = glance.heartRateZone {
            ZoneChip(zone: zone)
          }
        }
        .accessibilityElement(children: .combine)
      }
    }
  }

  /// How much of the interval has been ridden, as a thin bar.
  struct IntervalProgress: View {
    let progress: Double
    let color: Color

    var body: some View {
      Capsule()
        .fill(.quaternary)
        .overlay(alignment: .leading) {
          GeometryReader { proxy in
            Capsule().fill(color).frame(width: proxy.size.width * progress)
          }
        }
        .frame(height: 4)
        .accessibilityElement()
        .accessibilityLabel("Interval progress")
        .accessibilityValue(progress.formatted(.percent.precision(.fractionLength(0))))
    }
  }

  /// The interval's name in its zone colour, such as "Threshold 2/3", or that the ride is paused.
  struct IntervalTitle: View {
    let glance: RideGlance
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
      if glance.isPaused {
        Text("Paused").foregroundStyle(.orange)
      } else if let interval = glance.interval {
        Text(interval.title)
          .foregroundStyle(interval.zone.color.opacity(isLuminanceReduced ? 0.55 : 1))
      } else {
        Text("Done").foregroundStyle(.green)
      }
    }
  }

  /// A heart rate zone's number on its colour, such as "Z3".
  struct ZoneChip: View {
    let zone: RideGlance.HeartRateZone

    var body: some View {
      Text("Z\(zone.label)")
        .font(.system(size: 11, weight: .bold))
        .foregroundStyle(.black)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(
          Zone.color(index: zone.index, zoneCount: zone.zoneCount), in: .rect(cornerRadius: 5)
        )
        .accessibilityLabel("Zone \(zone.label)")
    }
  }

  /// Which sensor the heart rate comes from. A chest strap takes over from the watch when one is
  /// connected, since the wrist lags when gripping the bars.
  struct HeartRateSourceLabel: View {
    let source: HeartRateSource

    var body: some View {
      Label(title, systemImage: symbol)
        .font(.system(size: 11))
        .foregroundStyle(source == .chestStrap ? AnyShapeStyle(.green) : AnyShapeStyle(.secondary))
    }

    private var title: String {
      switch source {
      case .chestStrap: "HR from chest strap"
      case .watch: "HR from watch"
      case .simulated: "HR simulated"
      }
    }

    private var symbol: String {
      switch source {
      case .chestStrap: "waveform.path.ecg"
      case .watch: "applewatch"
      case .simulated: "wand.and.sparkles"
      }
    }
  }

  extension RideGlance {
    /// The design's sample: the second of three threshold efforts, part way through.
    static func sample(heartRateSource: HeartRateSource = .watch) -> RideGlance {
      RideGlance(
        workoutName: "Threshold waves 3×12",
        interval: .init(
          index: 4, zone: .threshold, number: 2, count: 3, targetPower: 250, remaining: 522,
          duration: 720),
        next: .init(zone: .recovery, targetPower: 120), power: 248,
        heartRate: heartRateSource == .chestStrap ? 154 : 152, heartRateSource: heartRateSource,
        heartRateZone: .init(label: "3", index: 2, zoneCount: 5))
    }
  }

  #Preview("Watch heart rate") {
    NavigationStack {
      GlanceView(glance: .sample())
    }
  }

  #Preview("Chest strap") {
    NavigationStack {
      GlanceView(glance: .sample(heartRateSource: .chestStrap))
    }
  }

  #Preview("Always On") {
    NavigationStack {
      GlanceView(glance: .sample())
    }
    .environment(\.isLuminanceReduced, true)
  }
#endif
