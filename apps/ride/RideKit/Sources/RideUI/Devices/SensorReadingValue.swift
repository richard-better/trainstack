import RideBluetooth
import SwiftUI

/// A sensor's live reading. Missing data is distinct from a measured zero.
struct SensorReadingValue: View {
  let metric: RideMetric
  let device: DiscoveredDevice
  @Environment(BluetoothDevices.self) private var devices
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    let value = devices.reading(for: metric, from: device.id)
    Group {
      if let value {
        HStack(spacing: 4) {
          if metric == .heartRate {
            Image(systemName: "heart.fill")
              .foregroundStyle(.red)
              .symbolEffect(.pulse, isActive: !reduceMotion)
              .accessibilityHidden(true)
          }
          Text("\(value) \(unit)")
            .monospacedDigit()
            .contentTransition(.numericText(value: Double(value)))
        }
        .animation(reduceMotion ? nil : .default, value: value)
      } else {
        Text(metric == .heartRate ? "Put the strap on" : "Waiting for data")
          .foregroundStyle(.secondary)
      }
    }
    .font(.callout)
  }

  private var unit: String {
    switch metric {
    case .power: "W"
    case .cadence: "rpm"
    case .heartRate: "bpm"
    }
  }
}
