import RideBluetooth
import SwiftUI

/// Which connected device a ride takes one of its readings from.
struct DataSourceRow: View {
  let metric: RideMetric
  @Environment(BluetoothDevices.self) private var devices

  var body: some View {
    LabeledContent {
      Text(devices.source(of: metric)?.displayName ?? "None")
    } label: {
      Label {
        Text(metric.name)
      } icon: {
        Image(systemName: metric.symbol).foregroundStyle(.secondary)
      }
    }
  }
}
