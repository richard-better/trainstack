import RideBluetooth
import SwiftUI

/// The rider's heart rate sensor, its connection and its live heart rate.
struct PairedSensorRow: View {
  let sensor: HeartRateSensor
  let paired: PairedSensor

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: "heart.fill")
        .font(.title2)
        .foregroundStyle(sensor.heartRate == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(.red))
        .symbolEffect(.pulse, isActive: sensor.heartRate != nil)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text(paired.name)
        Text(status)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      Spacer()
      heartRate
    }
    .accessibilityElement(children: .combine)
  }

  private var heartRate: some View {
    HStack(alignment: .firstTextBaseline, spacing: 4) {
      Group {
        if let bpm = sensor.heartRate {
          Text(bpm, format: .number)
            .contentTransition(.numericText(value: Double(bpm)))
        } else {
          Text(verbatim: "--")
            .foregroundStyle(.secondary)
            .accessibilityLabel("No reading")
        }
      }
      .font(.title.weight(.semibold))
      .fontDesign(.rounded)
      .monospacedDigit()
      Text("bpm")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
    .animation(.default, value: sensor.heartRate)
  }

  private var status: LocalizedStringKey {
    switch sensor.connection {
    case .waitingForBluetooth: "Waiting for Bluetooth"
    case .connecting: "Looking for sensor. Wake it and keep it nearby."
    case .connected: sensor.heartRate == nil ? "Connected. Put the sensor on." : "Connected"
    case .failed: "Couldn’t connect"
    }
  }
}
