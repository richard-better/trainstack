import RideBluetooth
import SwiftUI

/// The rider's paired devices and what each reading comes from, then the fitness devices in
/// range to pair. Searches for devices while on screen.
struct DevicesView: View {
  @Environment(BluetoothDevices.self) private var devices
  @Environment(RideLauncher.self) private var launcher
  @Environment(\.scenePhase) private var scenePhase
  @State private var showAll = false
  @State private var isOnScreen = false

  var body: some View {
    Group {
      if devices.availability == .ready {
        deviceList
      } else {
        bluetoothStatus
      }
    }
    .navigationTitle("Devices")
    .onAppear { isOnScreen = true }
    .onDisappear { isOnScreen = false }
    .onChange(of: isSearching, initial: true) { _, isSearching in
      if isSearching {
        devices.startScanning()
      } else {
        devices.stopScanning()
      }
    }
  }

  /// Whether the page can be seen. On iOS the player can cover it without it disappearing.
  private var isSearching: Bool {
    guard isOnScreen, scenePhase == .active else { return false }
    #if os(iOS)
      return !launcher.isPlayerPresented
    #else
      return true
    #endif
  }

  private var deviceList: some View {
    Form {
      Section {
        ForEach(RideMetric.allCases, id: \.self) { metric in
          SensorMetricRow(metric: metric)
        }
      } header: {
        Text("Sensors")
      } footer: {
        Text("Click a row to pick a different sensor. Ride remembers your pick for next time.")
      }

      Section {
        ForEach(devices.fitnessDevices) { device in
          NearbyDeviceRow(device: device)
        }
        if devices.fitnessDevices.isEmpty {
          Text("Wake your trainer or sensor and keep it nearby.")
            .foregroundStyle(.secondary)
        }
        Toggle(isOn: $showAll) {
          VStack(alignment: .leading, spacing: 1) {
            Text("Show other Bluetooth devices")
            Text(otherDevicesSummary)
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
        .accessibilityHint(
          "Include nearby Bluetooth devices that do not advertise a fitness service.")
        if showAll {
          ForEach(devices.otherDevices) { device in
            DeviceRow(device: device)
          }
        }
      } header: {
        HStack {
          Text("Nearby")
          Spacer()
          if devices.isScanning {
            Text("Searching…").fontWeight(.regular)
          }
        }
      }
    }
    .formStyle(.grouped)
  }

  private var otherDevicesSummary: LocalizedStringKey {
    let count = devices.otherDevices.count
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
    switch devices.availability {
    case .unknown: "Starting Bluetooth"
    case .resetting: "Restarting Bluetooth"
    case .poweredOff: "Bluetooth is off"
    case .unauthorized: "Allow Bluetooth access"
    case .unsupported: "Bluetooth unavailable"
    case .ready: "Bluetooth is ready"
    }
  }

  private var statusDescription: String {
    switch devices.availability {
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
    DevicesView()
  }
  .environment(BluetoothDevices())
  .environment(RideLauncher(simulated: true))
}
