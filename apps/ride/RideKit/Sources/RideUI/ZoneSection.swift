import Charts
import RideData
import SwiftUI

/// What the rider's zones are measured against. Stored in the app once a profile exists.
struct RiderProfile {
  var maxHeartRate = 186
}

/// A segmented choice between the ways of breaking down the ride.
struct ZoneSection: View {
  let recording: RideRecording
  var profile = RiderProfile()

  private enum Breakdown: String, CaseIterable, Identifiable {
    case heartRateZones = "Heart rate zones"
    case powerCurve = "Power curve"
    var id: Self { self }
  }

  @State private var choice = Breakdown.heartRateZones

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
          if shown.wrappedValue == .heartRateZones {
            Text("Zones from max HR \(profile.maxHeartRate)")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
        switch shown.wrappedValue {
        case .heartRateZones: zoneRows
        case .powerCurve: PowerCurveChart(points: recording.powerCurve())
        }
      }
    }
  }

  private var available: [Breakdown] {
    var result: [Breakdown] = []
    if !zones.isEmpty { result.append(.heartRateZones) }
    if !recording.powerCurve().isEmpty { result.append(.powerCurve) }
    return result
  }

  /// The chosen breakdown, or the first one the ride has data for.
  private var shown: Binding<Breakdown> {
    Binding(
      get: { available.contains(choice) ? choice : (available.first ?? choice) },
      set: { choice = $0 })
  }

  private var zones: [ZoneShare] {
    recording.heartRateZones(maxHeartRate: profile.maxHeartRate)
  }

  private var zoneRows: some View {
    Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
      ForEach(zones, id: \.zone) { share in
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
