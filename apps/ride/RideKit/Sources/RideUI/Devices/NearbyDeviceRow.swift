import RideBluetooth
import SwiftUI

/// A fitness device in range that isn't paired, with a button to pair and connect it.
struct NearbyDeviceRow: View {
  let device: DiscoveredDevice
  @Environment(BluetoothDevices.self) private var devices

  var body: some View {
    HStack(spacing: 12) {
      DeviceIcon(kind: device.kind)
      DeviceRow(device: device)
      Spacer()
      Button("Connect", action: pair)
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .controlSize(.small)
        .accessibilityLabel("Connect \(device.displayName)")
    }
  }

  private func pair() { devices.pair(device) }
}
