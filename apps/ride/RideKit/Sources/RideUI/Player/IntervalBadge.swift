import RideData
import RideStyle
import SwiftUI

struct IntervalBadge: View {
  let interval: RideSession.Interval
  let ftp: Int
  var isHighlighted = false

  var body: some View {
    let zone = interval.zone(ftp: ftp)
    Text(text(zone: zone))
      .font(.caption)
      .padding(.horizontal, 8)
      .padding(.vertical, 1)
      .background(
        isHighlighted
          ? AnyShapeStyle((zone?.color ?? .primary).opacity(0.35)) : AnyShapeStyle(.quaternary),
        in: .capsule)
  }

  private func text(zone: PowerZone?) -> String {
    if let name = interval.step.name { return name }
    if case .power = interval.step.target, let zone { return "Z\(zone.rawValue + 1) \(zone.name)" }
    return interval.title(ftp: ftp)
  }
}
