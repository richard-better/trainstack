import RideData
import SwiftUI

/// Where a zone ends, which moves where the next starts.
struct ZoneEndField: View {
  let zone: Zone
  let metric: ZoneMetric
  let scope: ZoneScope
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    @Bindable var store = store
    let end = $store[endOfZone: zone.index, for: metric, in: scope]
    Group {
      if metric == .pace {
        TextField("End of \(zone.name)", value: end, format: .pace)
      } else {
        TextField("End of \(zone.name)", value: end, format: .number.grouping(.never))
          #if os(iOS)
            .keyboardType(.numberPad)
          #endif
      }
    }
    .labelsHidden()
    .textFieldStyle(.roundedBorder)
    .multilineTextAlignment(.trailing)
  }
}
