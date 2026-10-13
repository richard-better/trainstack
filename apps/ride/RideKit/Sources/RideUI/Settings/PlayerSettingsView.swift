import RideData
import SwiftUI

/// How the player shows a ride.
struct PlayerSettingsView: View {
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    @Bindable var store = store
    Form {
      Section {
        Picker("Power display", selection: $store.powerDisplay) {
          ForEach(PowerDisplay.allCases, id: \.self) { display in
            Text(display.name).tag(display)
          }
        }
      } footer: {
        Text(
          "An average steadies the big power number when you ease off for a moment. The chart and your saved rides keep every reading."
        )
      }
    }
    .formStyle(.grouped)
    .navigationTitle("Player")
  }
}

#Preview {
  NavigationStack {
    PlayerSettingsView()
  }
  .environment(RiderSettingsStore.sample)
}
