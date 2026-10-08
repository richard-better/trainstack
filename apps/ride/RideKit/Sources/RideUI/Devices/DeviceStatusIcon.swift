import RideBluetooth
import SwiftUI

/// One kind of device as its symbol: with a green dot when connected, or orange with an orange
/// dot when it is missing.
struct DeviceStatusIcon: View {
  let kind: FitnessService
  let isConnected: Bool

  var body: some View {
    Image(systemName: kind.symbol)
      .foregroundStyle(isConnected ? Color.primary : .orange)
      .overlay(alignment: .topTrailing) {
        Circle()
          .fill(isConnected ? Color.green : .orange)
          .frame(width: 8, height: 8)
          .offset(x: 4, y: -3)
      }
  }
}
