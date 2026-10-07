import RideData
import SwiftUI

/// A sport in the list of zones, noting when it has none of its own.
struct SportRow: View {
  let sport: Sport
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    HStack {
      Text(sport.name)
      Spacer()
      if sport.metrics.allSatisfy({ store.current.usesDefault($0, in: sport) }) {
        Text("Default").foregroundStyle(.tertiary)
      }
    }
  }
}
