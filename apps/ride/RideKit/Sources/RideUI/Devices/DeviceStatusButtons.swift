import RideBluetooth
import SwiftUI

/// A status button for each kind of device a ride uses: always a trainer and a heart rate
/// strap, plus a power meter or cadence sensor once one is paired.
struct DeviceStatusButtons: View {
  let showDevices: () -> Void
  @Environment(BluetoothDevices.self) private var devices

  private static let kinds: [FitnessService] = [.trainer, .power, .heartRate, .speedAndCadence]
  private static let alwaysShown: Set<FitnessService> = [.trainer, .heartRate]

  var body: some View {
    ForEach(
      Self.kinds.filter { Self.alwaysShown.contains($0) || devices.paired($0) != nil }, id: \.self
    ) { kind in
      let device = devices.paired(kind)
      DeviceStatusButton(
        kind: kind, device: device,
        isConnected: device.map { devices.connectionState(of: $0.id) == .connected } ?? false,
        action: showDevices)
    }
  }
}
