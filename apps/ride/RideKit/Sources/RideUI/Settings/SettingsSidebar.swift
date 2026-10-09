import RideData
import SwiftUI

struct SettingsSidebar: View {
  @Binding var page: SettingsPage
  let back: () -> Void
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    List(selection: optionalPage) {
      Button(action: back) {
        Label("Back to app", systemImage: "chevron.left")
      }
      .buttonStyle(.borderless)
      .foregroundStyle(.secondary)
      Section {
        Label("Zones", systemImage: "chart.bar")
        Group {
          Text("Default").tag(SettingsPage.zones(.all))
          ForEach(store.current.listedSports, id: \.self) { sport in
            SportRow(sport: sport)
              .tag(SettingsPage.zones(.sport(sport)))
              .contextMenu {
                Button("Remove \(sport.name)", role: .destructive) { remove(sport) }
              }
          }
          AddSportMenu { page = .zones(.sport($0)) }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .foregroundStyle(.secondary)
        }
        .padding(.leading, 24)
        Label("Devices", systemImage: "antenna.radiowaves.left.and.right")
          .tag(SettingsPage.devices)
        Label("Strava", systemImage: "arrow.up.forward.app")
          .tag(SettingsPage.strava)
      } header: {
        Text("Settings").font(.title3).bold().foregroundStyle(.primary)
      }
    }
  }

  /// The page as a list takes it. Deselecting keeps the current page.
  private var optionalPage: Binding<SettingsPage?> {
    Binding(get: { page }, set: { if let page = $0 { self.page = page } })
  }

  private func remove(_ sport: Sport) {
    store.setListed(false, sport)
    if page == .zones(.sport(sport)) { page = .zones(.all) }
  }
}
