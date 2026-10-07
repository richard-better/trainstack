import RideBluetooth
import SwiftUI

/// One kind of device as an icon: with a green dot when connected, or orange with an orange
/// dot when it is missing. Opens the Devices sheet.
struct DeviceStatusButton: View {
  let kind: FitnessService
  /// The paired device of this kind, if any.
  let device: DiscoveredDevice?
  let isConnected: Bool
  let action: () -> Void

  var body: some View {
    // A custom label rather than a `Label`, which a toolbar would reduce to a plain symbol
    // and lose the status.
    Button(action: action) {
      Image(systemName: kind.symbol)
        .foregroundStyle(isConnected ? Color.primary : .orange)
        .overlay(alignment: .topTrailing) {
          Circle()
            .fill(isConnected ? Color.green : .orange)
            .frame(width: 8, height: 8)
            .offset(x: 4, y: -3)
        }
    }
    .accessibilityLabel(kind.name)
    .accessibilityValue(status)
    .accessibilityHint("Shows your devices.")
    .help("\(kind.name): \(status)")
  }

  private var status: String {
    guard let device else { return "Not paired" }
    return isConnected ? "\(device.displayName), connected" : "\(device.displayName), not connected"
  }
}
