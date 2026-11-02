import RideBluetooth
import SwiftUI

struct SensorOptionRow: View {
  let device: DiscoveredDevice
  let metric: RideMetric
  @Environment(BluetoothDevices.self) private var devices

  var body: some View {
    HStack(spacing: 12) {
      Button(action: choose) {
        HStack(spacing: 12) {
          Image(systemName: "checkmark")
            .fontWeight(.bold)
            .foregroundStyle(.tint)
            .opacity(isInUse ? 1 : 0)
            .frame(width: 16)
            .accessibilityHidden(true)
          VStack(alignment: .leading, spacing: 1) {
            Text(device.displayName)
            if let battery = batteryText {
              Text(battery)
                .font(.caption)
                .foregroundStyle(.secondary)
            }
          }
          Spacer()
        }
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .disabled(!isConnected)
      .accessibilityAddTraits(isInUse ? .isSelected : [])
      .accessibilityHint(isConnected ? "Uses this sensor for \(metric.name.lowercased())." : "")

      if isConnected, metric != .heartRate || isInUse {
        SensorReadingValue(metric: metric, device: device)
      }
      SensorConnectionStatus(device: device)
    }
    .swipeActions { forgetButton }
    .contextMenu { forgetButton }
  }

  private var isConnected: Bool { devices.connectionState(of: device.id) == .connected }

  private var isInUse: Bool { devices.source(of: metric)?.id == device.id }

  private var batteryText: String? {
    guard isConnected, let level = devices.batteryLevel(of: device.id) else { return nil }
    return "Battery \(level.formatted(.percent))"
  }

  private var forgetButton: some View {
    Button("Forget", systemImage: "trash", role: .destructive, action: forget)
  }

  private func choose() { devices.select(device, for: metric) }

  private func forget() { devices.forget(device.id) }
}
