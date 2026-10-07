import RideData
import SwiftUI

/// A finished ride in History: its title, day, headline numbers and time in zones.
struct RideRow: View {
  let ride: Ride
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    // Time in power zones when the rider has them, otherwise in heart rate zones.
    let zoneShares = [ZoneMetric.power, .heartRate].lazy
      .map { store.timeInZones(of: ride.recording, for: $0) }
      .first { !$0.isEmpty }
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(ride.title).font(.headline).lineLimit(1)
        Spacer(minLength: 0)
        Text(ride.recording.startDate, format: .dateTime.day().weekday(.abbreviated))
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      HStack(spacing: 10) {
        Text(ride.recording.summary.duration.clockString)
        if let power = ride.recording.summary.averagePower { Text("\(power) W") }
        if let heartRate = ride.recording.summary.averageHeartRate { Text("\(heartRate) bpm") }
      }
      .font(.caption.monospacedDigit())
      .foregroundStyle(.secondary)
      if let zoneShares {
        ZoneBar(shares: zoneShares).frame(height: 4)
      }
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }
}
