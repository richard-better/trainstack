import RideBluetooth
import SwiftUI

/// The rider's devices as a row of status icons, which opens the Devices sheet: always a
/// trainer and a heart rate strap, plus a power meter or cadence sensor once one is paired.
/// One button, so the row stays together in a toolbar rather than overflowing icon by icon.
struct DeviceStatusButton: View {
  let action: () -> Void
  @Environment(BluetoothDevices.self) private var devices
  @ScaledMetric private var spacing = 20.0

  private static let kinds: [FitnessService] = [.trainer, .power, .heartRate, .speedAndCadence]
  private static let alwaysShown: Set<FitnessService> = [.trainer, .heartRate]

  var body: some View {
    // A custom label rather than a `Label`, which a toolbar would reduce to a plain symbol.
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
