import RideData
import SwiftUI

/// Time in each zone over the last four weeks, by power or heart rate.
struct TimeInZoneSection: View {
  let rides: [RideRecording]
  @State private var choice: ZoneMetric?
  @Environment(RiderSettingsStore.self) private var settings
  @Environment(\.calendar) private var calendar

  /// The metrics the rider has Default zones for.
  private var metrics: [ZoneMetric] {
    [ZoneMetric.power, .heartRate].filter { settings.current.zones(for: $0, in: nil) != nil }
  }

  var body: some View {
    let title = Text("Time in zone · last 4 weeks").font(.headline)
    VStack(alignment: .leading, spacing: 14) {
      if metrics.count > 1 {
        ViewThatFits(in: .horizontal) {
          HStack {
            title
            Spacer()
            picker
          }
          VStack(alignment: .leading, spacing: 8) {
            title
            picker
          }
        }
      } else {
        title
      }
      if let metric = choice ?? metrics.first {
        let shares = recentRides.map { settings.timeInZones(of: $0, for: metric) }.combined()
        if shares.isEmpty {
          Text("No rides with this data in the last 4 weeks.")
            .font(.callout).foregroundStyle(.secondary)
        } else {
          ZoneTimeRows(shares: shares).font(.caption)
        }
      } else {
        Text("Set up your heart rate or power zones in Settings to see time in zone.")
          .font(.callout).foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .onChange(of: metrics, initial: true) { _, metrics in
      if let choice, metrics.contains(choice) { return }
      choice = metrics.first
    }
  }

  private var picker: some View {
    Picker("Zones", selection: $choice) {
      ForEach(metrics, id: \.self) { Text($0.title).tag(Optional($0)) }
    }
    .pickerStyle(.segmented)
    .labelsHidden()
    .fixedSize()
  }

  private var recentRides: [RideRecording] {
    let start = calendar.date(byAdding: .day, value: -28, to: .now) ?? .now
    return rides.filter { $0.startDate >= start }
  }
}
