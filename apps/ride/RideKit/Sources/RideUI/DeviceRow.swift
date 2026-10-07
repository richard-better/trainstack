import RideBluetooth
import SwiftUI

struct DeviceRow: View {
  let device: DiscoveredDevice

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(device.displayName)
      if let detail {
        Text(detail)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .accessibilityElement(children: .combine)
  }

  /// The roles a fitness device advertises, or an identifier to tell unnamed devices apart.
  private var detail: String? {
    if device.isFitness {
      return FitnessService.allCases.filter { device.services.contains($0) }
        .map(\.name).joined(separator: " · ")
    }
    return device.name == nil ? String(device.id.uuidString.prefix(8)) : nil
  }
}
