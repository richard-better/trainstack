import RideData
import SwiftUI

/// A bar of the zones side by side, each as wide as the values it covers.
struct ZoneScale: View {
  let zones: ZoneSet
  /// The easiest and hardest values shown.
  let range: (easiest: Int, hardest: Int)
  let metric: ZoneMetric
  let sport: Sport?

  var body: some View {
    VStack(spacing: 4) {
      GeometryReader { proxy in
        let widths = zones.zones.map(width)
        let total = widths.reduce(0, +)
        HStack(spacing: 1) {
          ForEach(zones.zones) { zone in
            Rectangle()
              .fill(zone.color)
              .frame(width: proxy.size.width * widths[zone.index] / total)
          }
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

  /// The share of the scale `zone` covers, never less than a sliver so every zone shows. Pace
  /// is flipped so that harder is always further along.
  private func width(of zone: Zone) -> Double {
    let sign = zones.isDescending ? -1 : 1
    let low = sign * range.easiest
    let high = sign * range.hardest
    let start = zone.start.map { max(sign * $0, low) } ?? low
    let end = zone.end.map { sign * $0 + 1 } ?? max(high, start + 1)
    return Double(max(1, end - start))
  }
}
