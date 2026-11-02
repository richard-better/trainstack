import RideBluetooth
import RideData
import SwiftUI

struct SettingsSplitView: View {
  @Binding var page: SettingsPage
  let back: () -> Void

  var body: some View {
    NavigationSplitView {
      SettingsSidebar(page: $page, back: back)
        .navigationSplitViewColumnWidth(min: 200, ideal: 220)
    } detail: {
      NavigationStack {
        SettingsPageView(page: page)
          .navigationDestination(for: SettingsPage.self) { page in
            SettingsPageView(page: page)
          }
      }
    }
  }
}

#Preview {
  @Previewable @State var page = SettingsPage.zones(.all)
  SettingsSplitView(page: $page) {}
    .environment(BluetoothDevices())
    .environment(RiderSettingsStore.sample)
}
