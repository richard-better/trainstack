import RideBluetooth
import SwiftUI

struct DevicesView: View {
  @State private var discovery = BluetoothDiscovery()
  @State private var showAll = false
  @Environment(\.dismiss) private var dismiss
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          Toggle("Show all", isOn: $showAll)
            .accessibilityHint(
              "Include nearby Bluetooth devices that do not advertise a fitness service.")

          if discovery.availability == .ready {
            availableDevices
          } else {
            bluetoothStatus
          }
        }
        .padding(24)
      }
      .navigationTitle("Devices")
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Close", systemImage: "xmark") { dismiss() }
        }
      }
    }
    #if os(macOS)
      .frame(minWidth: 460, idealWidth: 560, minHeight: 420, idealHeight: 600)
    #endif
    .onAppear {
      if scenePhase == .active { discovery.startScanning() }
    }
    .onDisappear { discovery.stopScanning() }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active {
        discovery.startScanning()
      } else {
        discovery.stopScanning()
      }
    }
  }

  private var availableDevices: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Available")
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(.secondary)

      ForEach(devices) { device in
        DeviceRow(device: device)
      }

      if devices.isEmpty {
        ContentUnavailableView {
          Label("Looking for devices", systemImage: "antenna.radiowaves.left.and.right")
        } description: {
          Text(
            "Wake your trainer or sensor and keep it nearby. Turn on Show all to see other Bluetooth devices."
          )
        }
      }

      HStack(spacing: 8) {
        ProgressView().controlSize(.small)
        Text("Scanning Bluetooth…")
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity)
      .padding(.top, 8)
    }
  }

  private var devices: [DiscoveredDevice] {
    discovery.fitnessDevices + (showAll ? discovery.otherDevices : [])
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

private struct DeviceRow: View {
  let device: DiscoveredDevice

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 12) {
        Image(systemName: "antenna.radiowaves.left.and.right")
          .foregroundStyle(device.services.isEmpty ? Color.secondary : Color.accentColor)
          .accessibilityHidden(true)
        Text(device.displayName)
          .font(.headline)
      }

      if device.name == nil {
        Text(String(device.id.uuidString.prefix(8)))
          .font(.caption.monospaced())
          .foregroundStyle(.secondary)
      }

      ViewThatFits(in: .horizontal) {
        HStack { serviceLabels }
        VStack(alignment: .leading, spacing: 8) { serviceLabels }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(20)
    .background(.quaternary, in: RoundedRectangle(cornerRadius: 16))
    .overlay {
      RoundedRectangle(cornerRadius: 16)
        .strokeBorder(.separator, lineWidth: 0.5)
    }
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder
  private var serviceLabels: some View {
    ForEach(FitnessService.allCases.filter { device.services.contains($0) }, id: \.self) {
      service in
      Text(service.name)
        .font(.caption.weight(.medium))
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
    }
  }
}

#Preview {
  DevicesView()
}
