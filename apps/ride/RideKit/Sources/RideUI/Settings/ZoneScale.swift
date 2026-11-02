import RideData
import RideStyle
import SwiftUI

struct ZoneScale: View {
  let zones: ZoneSet
  let range: (easiest: Int, hardest: Int)
  let metric: ZoneMetric
  let sport: Sport?

  var body: some View {
    VStack(spacing: 4) {
      ProportionalRow(spacing: 1) {
        ForEach(zones.zones) { zone in
          Rectangle()
            .fill(zone.color)
            .layoutProportion(width(of: zone))
        }
      }
      .frame(height: 10)
      .clipShape(.rect(cornerRadius: 3))
      HStack {
        Text(label(range.easiest))
        Spacer()
        Text(label(range.hardest))
      }
      .font(.caption.monospacedDigit())
      .foregroundStyle(.secondary)
    }
    .accessibilityHidden(true)
  }

  private func label(_ value: Int) -> String {
    "\(metric.format(value)) \(metric.unit(in: sport))"
  }

  private func width(of zone: Zone) -> Double {
    let sign = zones.isDescending ? -1 : 1
    let low = sign * range.easiest
    let high = sign * range.hardest
    let start = zone.start.map { max(sign * $0, low) } ?? low
    let end = zone.end.map { sign * $0 + 1 } ?? max(high, start + 1)
    return Double(max(1, end - start))
  }
}
