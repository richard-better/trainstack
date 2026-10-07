import RideBluetooth
import RideData
import SwiftUI

struct SettingsPageView: View {
  let page: SettingsPage
  let devices: BluetoothDevices

  var body: some View {
    switch page {
    case .zones(let scope): ZonesPage(scope: scope)
    case .ftpTests(let scope): FTPTestsView(scope: scope)
    case .devices: DevicesView(devices: devices)
    }
  }
}
