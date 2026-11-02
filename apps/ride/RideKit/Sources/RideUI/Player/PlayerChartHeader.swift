import RideData
import RideStyle
import SwiftUI

struct PlayerChartHeader: View {
  let controller: RideController

  var body: some View {
    let entries = Group {
      LegendSwatch(title: "Target", color: targetSwatch, height: 10)
      LegendSwatch(title: "Power", color: .primary.opacity(0.85), height: 2)
      LegendSwatch(title: "Heart rate", color: .red, height: 2)
    }
    let legend = ViewThatFits(in: .horizontal) {
      HStack(spacing: 16) { entries }
      VStack(alignment: .leading, spacing: 4) { entries }
    }
    ViewThatFits(in: .horizontal) {
      HStack {
        legend
        Spacer()
        Text(intervalLine).lineLimit(1)
      }
      VStack(alignment: .leading, spacing: 4) {
        Text(intervalLine)
        legend
      }
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }

  private var targetSwatch: AnyShapeStyle {
    guard controller.ftp > 0 else { return AnyShapeStyle(.primary.opacity(0.3)) }
    return AnyShapeStyle(
      LinearGradient(
        colors: PowerZone.allCases.map { $0.color.opacity(0.6) }, startPoint: .leading,
        endPoint: .trailing))
  }

  private var intervalLine: String {
    let session = controller.session
    guard let interval = session.currentInterval else { return "Workout complete" }
    return
      "Interval \(interval.index + 1) of \(session.intervals.count) · \(controller.zone(of: interval).name)"
  }
}
