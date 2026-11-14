#if os(watchOS)
  import RideData
  import RideLink
  import RideStyle
  import SwiftUI

  struct GlanceView: View {
    let glance: RideGlance
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
      VStack(alignment: .leading, spacing: 4) {
        if let interval = glance.interval {
          Text(interval.remainingClock(minutesOnly: isLuminanceReduced))
            .font(.system(size: 44, weight: isLuminanceReduced ? .medium : .semibold))
            .tracking(-1)
            .padding(.top, 4)
          if !isLuminanceReduced {
            IntervalProgress(progress: interval.progress, color: interval.zone?.color ?? .gray)
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
        if !isLuminanceReduced, let cue = glance.cue {
          Text(cue)
            .font(.system(size: 15, weight: .semibold))
            .lineLimit(2)
            .accessibilityAddTraits(.updatesFrequently)
        } else if !isLuminanceReduced, glance.heartRate != nil, let source = glance.heartRateSource
        {
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

    private func power(in interval: RideGlance.Interval) -> some View {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        if isLuminanceReduced {
          targetPowerHeldAllInterval(interval)
        } else {
          livePower(against: interval)
        }
      }
    }

    @ViewBuilder private func targetPowerHeldAllInterval(
      _ interval: RideGlance.Interval
    ) -> some View {
      if let target = interval.targetPower {
        Text("\(target) W")
          .font(.system(size: 30, weight: .medium))
          .foregroundStyle((interval.zone?.color ?? .gray).opacity(0.55))
      }
    }

    private func livePower(against interval: RideGlance.Interval) -> some View {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text(glance.power.map(String.init) ?? "--")
          .font(.system(size: 30, weight: .semibold))
          .foregroundStyle(interval.zone?.color ?? .gray)
          .contentTransition(.numericText())
        Text(interval.targetPower.map { "/ \($0) W" } ?? "W")
          .font(.system(size: 14))
          .foregroundStyle(.secondary)
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

  private struct IntervalProgress: View {
    let progress: Double
    let color: Color

    var body: some View {
      Capsule()
        .fill(.quaternary)
        .overlay {
          LeadingFraction(fraction: progress) {
            Capsule().fill(color)
          }
        }
        .frame(height: 4)
        .accessibilityElement()
        .accessibilityLabel("Interval progress")
        .accessibilityValue(progress.formatted(.percent.precision(.fractionLength(0))))
    }
  }

  private struct LeadingFraction: Layout {
    let fraction: Double

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
      proposal.replacingUnspecifiedDimensions()
    }

    func placeSubviews(
      in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) {
      let filled = ProposedViewSize(width: bounds.width * fraction, height: bounds.height)
      for subview in subviews {
        subview.place(at: bounds.origin, anchor: .topLeading, proposal: filled)
      }
    }
  }

  private struct ZoneChip: View {
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

  private struct HeartRateSourceLabel: View {
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
    static func sample(
      heartRateSource: HeartRateSource = .watch, cue: String? = nil
    ) -> RideGlance {
      RideGlance(
        workoutName: "Threshold waves 3×12",
        interval: .init(
          index: 4, zone: .threshold, numberInZone: 2, countInZone: 3, targetPower: 250,
          remaining: 522,
          duration: 720),
        next: .init(zone: .recovery, targetPower: 120), power: 248,
        heartRate: heartRateSource == .chestStrap ? 154 : 152, heartRateSource: heartRateSource,
        heartRateZone: .init(label: "3", index: 2, zoneCount: 5), cue: cue)
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

  #Preview("Interval text") {
    NavigationStack {
      GlanceView(glance: .sample(cue: "Wave 3: just over. Hang on"))
    }
  }

  #Preview("Always On") {
    NavigationStack {
      GlanceView(glance: .sample())
    }
    .environment(\.isLuminanceReduced, true)
  }
#endif
