import RideBluetooth
import SwiftUI

struct SensorMetricRow: View {
  let metric: RideMetric
  @Environment(BluetoothDevices.self) private var devices
  @State private var isExpanded = false

  var body: some View {
    Group {
      if canPick {
        Button {
          withAnimation { isExpanded.toggle() }
        } label: {
          metricLabel(showsChevron: true)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityValue(summary)
        .accessibilityHint(
          isExpanded ? "Hides the sensors." : "Shows the sensors you can pick from.")

        if isExpanded {
          ForEach(devices.sensors(of: metric)) { device in
            SensorOptionRow(device: device, metric: metric)
          }
        }
      } else {
        HStack(spacing: 12) {
          metricLabel(showsChevron: false)
          if let sensor = displayedSensor {
            SensorConnectionStatus(device: sensor)
          }
        }
        .swipeActions {
          if let sensor = displayedSensor { forgetButton(for: sensor) }
        }
        .contextMenu {
          if let sensor = displayedSensor { forgetButton(for: sensor) }
        }

        ForEach(otherSensors) { device in
          SensorOptionRow(device: device, metric: metric)
        }
      }
    }
    .onChange(of: canPick) { _, canPick in
      if !canPick { isExpanded = false }
    }
  }

  private var canPick: Bool { devices.connectedSensors(of: metric).count > 1 }

  private var displayedSensor: DiscoveredDevice? {
    devices.source(of: metric) ?? devices.sensors(of: metric).first
  }

  private var otherSensors: [DiscoveredDevice] {
    devices.sensors(of: metric).filter { $0.id != displayedSensor?.id }
  }

  private var summary: String {
    let sensors = devices.sensors(of: metric)
    guard let inUse = devices.source(of: metric) else {
      guard let first = sensors.first else { return "No sensor" }
      return sensors.count == 1
        ? "\(first.displayName) · Not connected"
        : "\(sensors.count) sensors · none connected"
    }
    let connected = devices.connectedSensors(of: metric)
    if connected.count > 1 { return "\(connected.count) connected · using \(inUse.displayName)" }
    return [inUse.displayName, batteryText(of: inUse)].compactMap(\.self).joined(separator: " · ")
  }

  private func metricLabel(showsChevron: Bool) -> some View {
    HStack(spacing: 12) {
      Image(systemName: metric.symbol)
        .foregroundStyle(.secondary)
        .frame(width: 26)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 1) {
        Text(metric.name)
        Text(summary)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      Spacer()
      reading
      if showsChevron {
        Image(systemName: "chevron.right")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.tertiary)
          .rotationEffect(.degrees(isExpanded ? 90 : 0))
          .accessibilityHidden(true)
      }
    }
  }

  @ViewBuilder private var reading: some View {
    if let source = devices.source(of: metric) {
      SensorReadingValue(metric: metric, device: source)
    } else {
      Text("None").foregroundStyle(.secondary)
    }
  }

  private func forgetButton(for device: DiscoveredDevice) -> some View {
    Button("Forget", systemImage: "trash", role: .destructive) { devices.forget(device.id) }
  }

  private func batteryText(of device: DiscoveredDevice) -> String? {
    devices.batteryLevel(of: device.id).map { "Battery \($0.formatted(.percent))" }
  }
}
