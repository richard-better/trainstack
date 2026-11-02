import RideBluetooth
import SwiftUI

struct SensorConnectionStatus: View {
  let device: DiscoveredDevice
  @Environment(BluetoothDevices.self) private var devices

  var body: some View {
    switch devices.connectionState(of: device.id) {
    case .connected:
      ConnectedLabel()
    case .connecting:
      HStack(spacing: 6) {
        ProgressView().controlSize(.small)
        Text("Connecting…")
      }
      .font(.subheadline)
      .foregroundStyle(.secondary)
    case .disconnected:
      Button("Connect") { devices.reconnect(device.id) }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .controlSize(.small)
        .accessibilityLabel("Connect \(device.displayName)")
    }
  }
}
