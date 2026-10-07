import Charts
import RideData
import RideStyle
import SwiftUI

/// Hours at each intensity per month for the last 12 months, from power zones when the rider
/// has an FTP and heart rate zones otherwise.
struct IntensitySection: View {
  let rides: [RideRecording]
  @Environment(RiderSettingsStore.self) private var settings
  @Environment(\.calendar) private var calendar
  @Environment(\.accessibilityDifferentiateWithoutColor) private var differentiateWithoutColor

  var body: some View {
    let months = months
    let totals = Dictionary(
      grouping: months.flatMap { $0.seconds.map { ($0.key, $0.value) } }, by: \.0
    ).mapValues { $0.reduce(0) { $0 + $1.1 } }
    let total = totals.values.reduce(0, +)
    VStack(alignment: .leading, spacing: 14) {
      VStack(alignment: .leading, spacing: 6) {
        Text("Intensity · last 12 months").font(.headline)
        HStack(spacing: 12) {
          ForEach(Intensity.allCases, id: \.self) { intensity in
            let share = total > 0 ? Int(((totals[intensity] ?? 0) / total * 100).rounded()) : 0
            LegendSwatch(
              title: "\(intensity.name) \(share)%",
              color: intensity.color(differentiatingWithoutColor: differentiateWithoutColor),
              height: 10)
          }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
      }
      Chart {
        ForEach(months) { month in
          ForEach(Intensity.allCases.reversed(), id: \.self) { intensity in
            let hours = (month.seconds[intensity] ?? 0) / 3600
            BarMark(
              x: .value("Month", month.start, unit: .month),
              y: .value("Hours", hours)
            )
            .foregroundStyle(
              intensity.color(differentiatingWithoutColor: differentiateWithoutColor)
            )
            .accessibilityLabel(month.start.formatted(.dateTime.month(.wide).year()))
            .accessibilityValue(
              "\(intensity.name): \(hours.formatted(.number.precision(.fractionLength(1)))) h")
          }
        }
      }
      .chartYAxis(.hidden)
      .chartXAxis {
        AxisMarks(values: .stride(by: .month)) { _ in
          AxisValueLabel(format: .dateTime.month(.narrow), centered: true)
        }
      }
      .frame(height: 150)
      .accessibilityLabel("Hours at each intensity by month")
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var months: [IntensityMonth] {
    let thisMonth = calendar.dateInterval(of: .month, for: .now)?.start ?? .now
    return (0..<12).reversed().compactMap { offset in
      guard let start = calendar.date(byAdding: .month, value: -offset, to: thisMonth),
        let end = calendar.date(byAdding: .month, value: 1, to: start)
      else { return nil }
      var seconds: [Intensity: TimeInterval] = [:]
      for ride in rides where (start..<end).contains(ride.startDate) {
        for (intensity, time) in intensities(of: ride) { seconds[intensity, default: 0] += time }
      }
      return IntensityMonth(start: start, seconds: seconds)
    }
  }

  /// Time at each intensity, from the first of power and heart rate the ride has zones for.
  private func intensities(of ride: RideRecording) -> [(Intensity, TimeInterval)] {
    let shares = [ZoneMetric.power, .heartRate].lazy.map {
      settings.timeInZones(of: ride, for: $0)
    }
    return (shares.first { !$0.isEmpty } ?? []).map { ($0.zone.intensity, $0.seconds) }
  }
}
