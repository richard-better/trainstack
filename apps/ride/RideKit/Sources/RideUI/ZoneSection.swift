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
        // Side by side with room to spare, otherwise stacked, and as a menu on a narrow phone.
        ViewThatFits(in: .horizontal) {
          HStack {
            picker.pickerStyle(.segmented).fixedSize()
            Spacer()
            basisCaption
          }
          VStack(alignment: .leading, spacing: 6) {
            picker.pickerStyle(.segmented).fixedSize()
            basisCaption
          }
          VStack(alignment: .leading, spacing: 6) {
            picker.pickerStyle(.menu).fixedSize()
            basisCaption
          }
        }
        content(of: shown.wrappedValue)
      }
    }
  }

  private var picker: some View {
    Picker("Breakdown", selection: shown) {
      ForEach(available) { Text($0.rawValue).tag($0) }
    }
    .labelsHidden()
  }

  @ViewBuilder private var basisCaption: some View {
    if let basis = basis(of: shown.wrappedValue) {
      Text(basis).font(.caption).foregroundStyle(.secondary)
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
      ZoneTimeRows(shares: recording.timeInZones(zones, of: metric)).font(.callout)
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

private struct PowerCurveChart: View {
  let points: [PowerCurvePoint]

  var body: some View {
    // Durations are spaced evenly, since they are chosen to be readable rather than to scale.
    Chart(points, id: \.duration) { point in
      LineMark(x: .value("Duration", point.duration.spokenString), y: .value("Power", point.power))
        .interpolationMethod(.monotone)
      PointMark(x: .value("Duration", point.duration.spokenString), y: .value("Power", point.power))
        .annotation(position: .top, spacing: 4) {
          Text("\(point.power) W").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
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
