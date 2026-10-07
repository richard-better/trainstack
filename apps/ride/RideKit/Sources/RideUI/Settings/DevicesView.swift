import RideBluetooth
import SwiftUI

struct DevicesView: View {
  let discovery: BluetoothDiscovery
  @Environment(HeartRateSensor.self) private var sensor
  @State private var showAll = false

  var body: some View {
    Group {
      if discovery.availability == .ready {
        deviceList
      } else {
        bluetoothStatus
      }
    }
    .navigationTitle("Devices")
  }

  private var deviceList: some View {
    Form {
      if let paired = sensor.paired {
        Section("Heart rate sensor") {
          PairedSensorRow(sensor: sensor, paired: paired)
          if sensor.connection == .failed {
            Button("Try Again", systemImage: "arrow.clockwise", action: sensor.reconnect)
          }
          Button(
            "Forget Sensor", systemImage: "xmark.circle", role: .destructive, action: sensor.forget)
        }
      }

      Section {
        ForEach(nearbyDevices) { device in
          if device.services.contains(.heartRate) {
            LabeledContent {
              Button("Connect") { sensor.pair(device) }
                .accessibilityLabel("Connect to \(device.displayName)")
            } label: {
              DeviceRow(device: device)
            }
          } else {
            DeviceRow(device: device)
          }
        }
        if nearbyDevices.isEmpty {
          Text("Wake your trainer or sensor and keep it nearby.")
            .foregroundStyle(.secondary)
        }
      } header: {
        HStack(spacing: 8) {
          Text("Nearby fitness devices")
          if discovery.isScanning {
            ProgressView()
              .controlSize(.mini)
              .accessibilityLabel("Scanning")
          }
        }
      }

      Section {
        Toggle("Show other Bluetooth devices", isOn: $showAll)
          .accessibilityHint(
            "Include nearby Bluetooth devices that do not advertise a fitness service.")
        if showAll {
          ForEach(discovery.otherDevices) { device in
            DeviceRow(device: device)
          }
        }
      } footer: {
        Text(otherDevicesSummary)
      }
    }
    .formStyle(.grouped)
  }

  /// Fitness devices in range, apart from the paired sensor, which has its own section.
  private var nearbyDevices: [DiscoveredDevice] {
    discovery.fitnessDevices.filter { $0.id != sensor.paired?.id }
  }

  private var otherDevicesSummary: LocalizedStringKey {
    let count = discovery.otherDevices.count
    if count == 0 { return "No other Bluetooth devices nearby" }
    return showAll
      ? "^[\(count) other Bluetooth device](inflect: true) shown"
      : "^[\(count) other Bluetooth device](inflect: true) hidden"
  }

  private var bluetoothStatus: some View {
    ContentUnavailableView {
      Label(statusTitle, systemImage: "antenna.radiowaves.left.and.right.slash")
    } description: {
      Text(statusDescription)
    }
  }

  private var statusTitle: String {
    switch discovery.availability {
    case .unknown: "Starting Bluetooth"
    case .resetting: "Restarting Bluetooth"
    case .poweredOff: "Bluetooth is off"
    case .unauthorized: "Allow Bluetooth access"
    case .unsupported: "Bluetooth unavailable"
    case .ready: "Bluetooth is ready"
    }
  }

  private var statusDescription: String {
    switch discovery.availability {
    case .unknown, .resetting: "Devices will appear when Bluetooth is ready."
    case .poweredOff: "Turn on Bluetooth in Settings to find nearby devices."
    case .unauthorized: "Allow Ride to use Bluetooth in Settings > Privacy & Security > Bluetooth."
    case .unsupported: "This device does not support Bluetooth Low Energy."
    case .ready: "Wake your trainer or sensor to find it here."
    }
  }
}

#Preview {
  NavigationStack {
    DevicesView(discovery: BluetoothDiscovery())
  }
  .environment(HeartRateSensor())
}
