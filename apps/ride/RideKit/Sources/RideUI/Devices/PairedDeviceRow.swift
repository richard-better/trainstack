import RideBluetooth
import SwiftUI

/// A device the rider has paired: what it is, its battery, whether it is connected, and for the
/// heart rate strap the live heart rate. Forget it by swiping or from its context menu.
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
        if isHeartRateSource {
          heartRate
        }
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

  private var isHeartRateSource: Bool { devices.source(of: .heartRate)?.id == device.id }

  private var heartRate: some View {
    Group {
      if let bpm = devices.heartRate {
        HStack(spacing: 4) {
          Image(systemName: "heart.fill")
            .foregroundStyle(.red)
            .symbolEffect(.pulse)
            .accessibilityHidden(true)
          Text("\(bpm) bpm")
            .monospacedDigit()
            .contentTransition(.numericText(value: Double(bpm)))
        }
        .animation(.default, value: bpm)
      } else {
        Text("Put the strap on to see your heart rate")
      }
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }

  private var forgetButton: some View {
    Button("Forget", systemImage: "trash", role: .destructive, action: forget)
  }

  private func reconnect() { devices.reconnect(device.id) }

  private func forget() { devices.forget(device.id) }
}
