import RideData
import RideStyle
import SwiftUI

/// Time in each zone as one bar, with a legend of how many minutes each gets.
struct WorkoutZoneMix: View {
  let template: WorkoutTemplate

  var body: some View {
    let zones = template.timeInZones
    VStack(alignment: .leading, spacing: 6) {
      ProportionalRow(spacing: 2) {
        ForEach(zones) { zone in
          Rectangle().fill(zone.zone.color).layoutProportion(zone.seconds)
        }
      }
      .frame(height: 10)
      .clipShape(.capsule)
      .accessibilityHidden(true)
      FlowLayout {
        ForEach(zones) { zone in
          HStack(spacing: 5) {
            Circle().fill(zone.zone.color).frame(width: 7, height: 7)
            Text("\(zone.zone.name) \(zone.seconds.spokenString)")
          }
          .accessibilityElement(children: .combine)
        }
      }
      .font(.caption)
      .foregroundStyle(.secondary)
    }
  }
}
