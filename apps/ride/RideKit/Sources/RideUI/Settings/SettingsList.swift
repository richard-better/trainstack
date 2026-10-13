import RideData
import SwiftUI

/// Settings as a list that drills into each page, for iPhone.
struct SettingsList: View {
  @Binding var path: [SettingsPage]
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    NavigationStack(path: $path) {
      List {
        Section("Zones") {
          NavigationLink("Default", value: SettingsPage.zones(.all))
          ForEach(store.current.listedSports, id: \.self) { sport in
            NavigationLink(value: SettingsPage.zones(.sport(sport))) { SportRow(sport: sport) }
          }
          .onDelete(perform: unlistSports)
          AddSportMenu { path.append(.zones(.sport($0))) }
        }
        Section {
          NavigationLink(value: SettingsPage.rider) {
            Label("Rider", systemImage: "figure.outdoor.cycle")
          }
          NavigationLink(value: SettingsPage.player) {
            Label("Player", systemImage: "gauge.with.needle")
          }
          NavigationLink(value: SettingsPage.devices) {
            Label("Devices", systemImage: "antenna.radiowaves.left.and.right")
          }
          NavigationLink(value: SettingsPage.account) {
            Label("Account", systemImage: "person.crop.circle")
          }
        }
      }
      .navigationTitle("Settings")
      .navigationDestination(for: SettingsPage.self) { page in
        SettingsPageView(page: page)
      }
    }
  }

  /// Removes the sports at `offsets` from the list, along with their zones.
  private func unlistSports(at offsets: IndexSet) {
    let sports = store.current.listedSports
    for offset in offsets { store.setListed(false, sports[offset]) }
  }
}
