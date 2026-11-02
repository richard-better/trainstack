import RideBluetooth
import SwiftUI

struct DeviceIcon: View {
  let kind: FitnessService?
  @ScaledMetric private var size = 36.0

  var body: some View {
    Image(systemName: kind?.symbol ?? "dot.radiowaves.left.and.right")
      .font(.title3)
      .frame(width: size, height: size)
      .background(.fill.tertiary, in: .rect(cornerRadius: size * 0.28))
      .accessibilityHidden(true)
  }
}
