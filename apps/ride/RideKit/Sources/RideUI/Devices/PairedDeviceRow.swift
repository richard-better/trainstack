import RideBluetooth
import SwiftUI

/// A device the rider has paired: what it is, its battery, and whether it is connected. Forget
/// it by swiping or from its context menu.
struct PairedDeviceRow: View {
  let device: DiscoveredDevice
  @Environment(BluetoothDevices.self) private var devices

  var body: some View {
    HStack(spacing: 12) {
      DeviceIcon(kind: device.kind)
      VStack(alignment: .leading, spacing: 1) {
        if let kind = device.kind {
          Text(kind.name).font(.caption).foregroundStyle(.secondary)
        }
        Text(device.displayName).font(.headline)
        if let battery = devices.batteryLevel(of: device.id) {
          Text("Battery \(battery.formatted(.percent))")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
      .accessibilityElement(children: .combine)
      Spacer()
      status
    }
    .swipeActions { forgetButton }
    .contextMenu { forgetButton }
  }

  @ViewBuilder private var status: some View {
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
      Button("Connect", action: reconnect)
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .controlSize(.small)
        .accessibilityLabel("Connect \(device.displayName)")
    }
  }

  private var forgetButton: some View {
    Button("Forget", systemImage: "trash", role: .destructive, action: forget)
  }

  private func reconnect() { devices.reconnect(device.id) }

  private func forget() { devices.forget(device.id) }
}
