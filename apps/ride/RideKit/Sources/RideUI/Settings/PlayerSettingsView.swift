import RideData
import SwiftUI

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
      Section {
        Toggle("Power match", isOn: $store.matchesPowerMeter)
      } footer: {
        Text(
          "With a power meter paired as well as your trainer, ERG holds the target on the power meter, the power your rides record. Ride corrects the trainer by at most 10%, and rides on the trainer alone while the meter is quiet."
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
