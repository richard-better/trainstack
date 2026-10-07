import RideBluetooth
import SwiftUI

struct DevicesView: View {
  let discovery: BluetoothDiscovery
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
      Section {
        ForEach(discovery.fitnessDevices) { device in
          DeviceRow(device: device)
        }
        if discovery.fitnessDevices.isEmpty {
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
}
