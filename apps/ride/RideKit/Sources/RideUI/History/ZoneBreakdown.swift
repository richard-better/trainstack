import RideData
import SwiftUI

struct ZoneBreakdown: View {
  let recording: RideRecording
  let metric: ZoneMetric
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    let settings = store.settings(for: metric, of: recording)
    if let zones = settings?.zones {
      ZoneTimeRows(shares: recording.timeInZones(zones, of: metric)).font(.callout)
    } else if let missing = settings?.missingThresholds, !missing.isEmpty {
      MissingSetting(
        "Add your \(missing.map(\.name).formatted(.list(type: .and))) in Settings to see \(metric.name) zones."
      )
    } else {
      MissingSetting(
        "Check your \(metric.name) thresholds in Settings: they leave no room for every zone.")
    }
  }
}
