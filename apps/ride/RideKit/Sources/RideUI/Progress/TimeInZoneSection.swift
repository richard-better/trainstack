import RideData
import SwiftUI

struct TimeInZoneSection: View {
  let rides: [RideRecording]
  @State private var choice: ZoneMetric?
  @Environment(RiderSettingsStore.self) private var settings
  @Environment(\.calendar) private var calendar

  private var metricsWithZones: [ZoneMetric] {
    [ZoneMetric.power, .heartRate].filter { settings.current.zones(for: $0, in: nil) != nil }
  }

  var body: some View {
    let title = Text("Time in zone · last 4 weeks").font(.headline)
    VStack(alignment: .leading, spacing: 14) {
      if metricsWithZones.count > 1 {
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
      if let metric = choice ?? metricsWithZones.first {
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
    .onChange(of: metricsWithZones, initial: true) { _, metricsWithZones in
      if let choice, metricsWithZones.contains(choice) { return }
      choice = metricsWithZones.first
    }
  }

  private var picker: some View {
    SegmentedPicker(
      title: "Zones", options: metricsWithZones,
      selection: Binding(get: { choice ?? metricsWithZones[0] }, set: { choice = $0 }),
      label: \.title
    )
    .fixedSize()
  }

  private var recentRides: [RideRecording] {
    let start = calendar.date(byAdding: .day, value: -28, to: .now) ?? .now
    return rides.filter { $0.startDate >= start }
  }
}
