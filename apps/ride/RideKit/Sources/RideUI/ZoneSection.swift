import Charts
import RideData
import SwiftUI

/// A segmented choice between the ways of breaking down the ride.
struct ZoneSection: View {
  let recording: RideRecording
  @Environment(RiderProfileStore.self) private var profile

  private enum Breakdown: String, CaseIterable, Identifiable {
    case powerZones = "Power zones"
    case heartRateZones = "Heart rate zones"
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
    case .powerZones: profile.ftp != nil
    case .heartRateZones: profile.maxHeartRate != nil
    case .powerCurve: true
    }
  }

  private func basis(of breakdown: Breakdown) -> String? {
    switch breakdown {
    case .powerZones: profile.ftp.map { "Zones from FTP \($0) W" }
    case .heartRateZones: profile.maxHeartRate.map { "Zones from max HR \($0)" }
    case .powerCurve: nil
    }
  }

  @ViewBuilder private func content(of breakdown: Breakdown) -> some View {
    switch breakdown {
    case .powerZones:
      if let ftp = profile.ftp {
        ZoneRows(shares: recording.powerZones(ftp: ftp))
      } else {
        MissingSetting("Add your FTP in Settings to see power zones.")
      }
    case .heartRateZones:
      if let maxHeartRate = profile.maxHeartRate {
        ZoneRows(shares: recording.heartRateZones(maxHeartRate: maxHeartRate))
      } else {
        MissingSetting("Add your max heart rate in Settings to see heart rate zones.")
      }
    case .powerCurve:
      PowerCurveChart(points: recording.powerCurve())
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

private struct ZoneRows<Zone: RideZone>: View {
  let shares: [ZoneShare<Zone>]

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
