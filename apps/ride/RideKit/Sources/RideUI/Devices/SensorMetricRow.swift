import RideBluetooth
import SwiftUI

/// A reading the ride takes, with the sensor it comes from and that sensor's live heart rate.
/// Tapping it opens the sensors that can supply the reading, so the rider can pick one. Where
/// several sensors report the reading, the row says how many there are and which one is in use.
struct SensorMetricRow: View {
  let metric: RideMetric
  @Environment(BluetoothDevices.self) private var devices
  @State private var isExpanded = false

  var body: some View {
    Group {
      Button {
        withAnimation { isExpanded.toggle() }
      } label: {
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
          Image(systemName: "chevron.right")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.tertiary)
            .rotationEffect(.degrees(isExpanded ? 90 : 0))
            .accessibilityHidden(true)
        }
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .accessibilityValue(summary)
      .accessibilityHint(isExpanded ? "Hides the sensors." : "Shows the sensors you can pick from.")

      if isExpanded {
        ForEach(devices.sensors(of: metric)) { device in
          SensorOptionRow(device: device, metric: metric)
        }
      }
    }
  }

  private var summary: String {
    let sensors = devices.sensors(of: metric)
    guard let first = sensors.first else { return "No sensor" }
    guard let inUse = devices.source(of: metric) else {
      return sensors.count == 1
        ? "\(first.displayName) · Not connected"
        : "\(sensors.count) sensors · none connected"
    }
    if sensors.count > 1 { return "\(sensors.count) sensors · using \(inUse.displayName)" }
    return [inUse.displayName, batteryText(of: inUse)].compactMap(\.self).joined(separator: " · ")
  }

  @ViewBuilder private var reading: some View {
    if devices.source(of: metric) == nil {
      Text("None").foregroundStyle(.secondary)
    } else if metric == .heartRate {
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
        .font(.callout)
        .animation(.default, value: bpm)
      } else {
        Text("Put the strap on").foregroundStyle(.secondary)
      }
    }
  }

  private func batteryText(of device: DiscoveredDevice) -> String? {
    devices.batteryLevel(of: device.id).map { "Battery \($0.formatted(.percent))" }
  }
}
