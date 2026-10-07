import Charts
import RideData
import SwiftUI

/// A segmented choice between the ways of breaking down the ride.
struct ZoneSection: View {
  let recording: RideRecording
  @Environment(RiderSettingsStore.self) private var store

  private enum Breakdown: String, CaseIterable, Identifiable {
    case powerZones = "Power zones"
    case heartRateZones = "Heart rate zones"
    case paceZones = "Pace zones"
    case powerCurve = "Power curve"
    var id: Self { self }
  }

  @State private var choice: Breakdown?

  var body: some View {
    if !available.isEmpty {
      VStack(alignment: .leading, spacing: 14) {
        HStack {
          Picker("Breakdown", selection: shown) {
            ForEach(available) { Text($0.rawValue).tag($0) }
          }
          .pickerStyle(.segmented)
          .labelsHidden()
          .fixedSize()
          Spacer()
          if let basis = basis(of: shown.wrappedValue) {
            Text(basis).font(.caption).foregroundStyle(.secondary)
          }
        }
        content(of: shown.wrappedValue)
      }
    }
  }

  private var available: [Breakdown] {
    Breakdown.allCases.filter {
      switch $0 {
      case .powerZones, .powerCurve: recording.hasPower
      case .heartRateZones: recording.hasHeartRate
      case .paceZones: recording.sport?.paceDistance != nil && recording.hasSpeed
      }
    }
  }

  /// The chosen breakdown, or the first one that has what it needs from the rider's profile.
  private var shown: Binding<Breakdown> {
    Binding(
      get: {
        if let choice, available.contains(choice) { return choice }
        return available.first(where: isConfigured) ?? available.first ?? .powerCurve
      },
      set: { choice = $0 })
  }

  private func isConfigured(_ breakdown: Breakdown) -> Bool {
    switch breakdown {
    case .powerZones: store.zones(for: .power, of: recording) != nil
    case .heartRateZones: store.zones(for: .heartRate, of: recording) != nil
    case .paceZones: store.zones(for: .pace, of: recording) != nil
    case .powerCurve: true
    }
  }

  private func basis(of breakdown: Breakdown) -> String? {
    switch breakdown {
    case .powerZones: basis(of: .power)
    case .heartRateZones: basis(of: .heartRate)
    case .paceZones: basis(of: .pace)
    case .powerCurve: nil
    }
  }

  /// What the zones for `metric` come from, such as "Zones from FTP 200 W".
  private func basis(of metric: ZoneMetric) -> String? {
    guard let settings = store.settings(for: metric, of: recording), settings.zones != nil
    else { return nil }
    if settings.choice.isCustom { return "Custom zones" }
    let values = settings.choice.model.basis.thresholds.compactMap { threshold in
      settings.thresholds[threshold].map {
        "\(threshold.abbreviation) \(metric.format($0)) \(metric.unit(in: recording.sport))"
      }
    }
    return "Zones from " + values.formatted(.list(type: .and))
  }

  @ViewBuilder private func content(of breakdown: Breakdown) -> some View {
    switch breakdown {
    case .powerZones: zones(of: .power)
    case .heartRateZones: zones(of: .heartRate)
    case .paceZones: zones(of: .pace)
    case .powerCurve: PowerCurveChart(points: recording.powerCurve())
    }
  }

  @ViewBuilder private func zones(of metric: ZoneMetric) -> some View {
    let name = metric.name
    let settings = store.settings(for: metric, of: recording)
    if let zones = settings?.zones {
      ZoneRows(shares: recording.timeInZones(zones, of: metric))
    } else if let missing = settings?.missingThresholds, !missing.isEmpty {
      MissingSetting(
        "Add your \(missing.map(\.name).formatted(.list(type: .and))) in Settings to see \(name) zones."
      )
    } else {
      MissingSetting(
        "Check your \(name) thresholds in Settings: they leave no room for every zone.")
    }
  }
}

private struct MissingSetting: View {
  let message: LocalizedStringKey

  init(_ message: LocalizedStringKey) { self.message = message }

  var body: some View {
    Label(message, systemImage: "gearshape")
      .font(.callout)
      .foregroundStyle(.secondary)
      .padding(.vertical, 8)
  }
}

private struct ZoneRows: View {
  let shares: [ZoneShare]

  var body: some View {
    Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
      ForEach(shares, id: \.zone) { share in
        GridRow {
          Text(share.zone.name).foregroundStyle(.secondary).gridColumnAlignment(.leading)
          ProgressBar(fraction: share.fraction, color: share.zone.color)
          Text("\(Int((share.fraction * 100).rounded()))%")
            .gridColumnAlignment(.trailing)
          Text(share.seconds.spokenString)
            .foregroundStyle(.secondary)
            .gridColumnAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
      }
    }
    .font(.callout.monospacedDigit())
  }
}

private struct ProgressBar: View {
  let fraction: Double
  let color: Color

  var body: some View {
    Capsule()
      .fill(.quaternary.opacity(0.6))
      .frame(height: 8)
      .overlay(alignment: .leading) {
        GeometryReader { proxy in
          Capsule().fill(color).frame(width: proxy.size.width * fraction)
        }
      }
      .frame(maxWidth: .infinity)
  }
}

private struct PowerCurveChart: View {
  let points: [PowerCurvePoint]

  var body: some View {
    // Durations are spaced evenly, since they are chosen to be readable rather than to scale.
    Chart(points, id: \.duration) { point in
      LineMark(x: .value("Duration", point.duration.spokenString), y: .value("Power", point.power))
        .interpolationMethod(.monotone)
      PointMark(x: .value("Duration", point.duration.spokenString), y: .value("Power", point.power))
        .annotation(position: .top, spacing: 4) {
          Text("\(point.power) W").font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
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
