import RideData
import RideStyle
import SwiftUI

struct ZoneRow: View {
  let zones: ZoneSet
  let zone: Zone
  let metric: ZoneMetric
  let scope: ZoneScope
  let isEditable: Bool
  let percentageBase: Int?
  let hasPercentColumn: Bool
  @Environment(RiderSettingsStore.self) private var store
  @ScaledMetric private var labelWidth = ZoneColumnWidth.label
  @ScaledMetric private var limitWidth = ZoneColumnWidth.limit
  @ScaledMetric private var percentWidth = ZoneColumnWidth.percent

  var body: some View {
    HStack(spacing: 10) {
      Circle().fill(zone.color).frame(width: 8, height: 8)
      Text(zone.label)
        .foregroundStyle(.secondary)
        .frame(width: labelWidth, alignment: .leading)
      VStack(alignment: .leading, spacing: 2) {
        Text(zone.name).lineLimit(1)
        if !hasPercentColumn, let percentageBase {
          Text(percentages(of: percentageBase)).font(.caption).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
      Group {
        if let start = zone.start {
          Text(metric.format(start))
        } else {
          Text(zones.isDescending ? "slower" : "0").foregroundStyle(.secondary)
        }
      }
      .frame(width: limitWidth, alignment: .trailing)
      Text("–").foregroundStyle(.secondary)
      Group {
        if let end = zone.end {
          if isEditable {
            ZoneEndField(zone: zone, metric: metric, scope: scope)
          } else {
            Text(metric.format(end))
          }
        } else {
          Text(zones.isDescending ? "faster" : "and up").foregroundStyle(.secondary)
        }
      }
      .frame(width: limitWidth, alignment: .leading)
      if hasPercentColumn, let percentageBase {
        Text(percentages(of: percentageBase))
          .foregroundStyle(.secondary)
          .frame(width: percentWidth, alignment: .trailing)
      }
    }
    .monospacedDigit()
  }

  private func percentages(of reference: Int) -> String {
    guard reference > 0 else { return "" }
    func percent(_ value: Int) -> Int {
      Int((Double(value) / Double(reference) * 100).rounded())
    }
    let (easier, harder) = zones.isDescending ? ("over", "and faster") : ("under", "and up")
    guard let start = zone.start else {
      return zones.zones[1].start.map { "\(easier) \(percent($0))%" } ?? ""
    }
    guard let end = zone.end else { return "\(percent(start))% \(harder)" }
    let (low, high) = zones.isDescending ? (end, start) : (start, end)
    return "\(percent(low))–\(percent(high))%"
  }
}
