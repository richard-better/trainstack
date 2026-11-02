import RideBluetooth
import SwiftUI

struct DeviceStatusButton: View {
  let action: () -> Void
  @Environment(BluetoothDevices.self) private var devices
  @ScaledMetric private var spacing = 20.0

  private static let kinds: [FitnessService] = [.trainer, .power, .heartRate, .speedAndCadence]
  private static let alwaysShown: Set<FitnessService> = [.trainer, .heartRate]

  var body: some View {
    Button(action: action) {
      HStack(spacing: spacing) {
        ForEach(kinds, id: \.self) { kind in
          DeviceStatusIcon(kind: kind, isConnected: isConnected(kind))
        }
      }
    }
    .accessibilityLabel("Devices")
    .accessibilityValue(kinds.map(status).joined(separator: ", "))
    .accessibilityHint("Shows your devices.")
  }

  private var kinds: [FitnessService] {
    Self.kinds.filter { Self.alwaysShown.contains($0) || devices.paired($0) != nil }
  }

  private func isConnected(_ kind: FitnessService) -> Bool {
    guard let device = devices.paired(kind) else { return false }
    return devices.connectionState(of: device.id) == .connected
  }

  private func status(_ kind: FitnessService) -> String {
    guard let device = devices.paired(kind) else { return "\(kind.name) not paired" }
    let state = isConnected(kind) ? "connected" : "not connected"
    return "\(kind.name) \(device.displayName) \(state)"
  }
}
