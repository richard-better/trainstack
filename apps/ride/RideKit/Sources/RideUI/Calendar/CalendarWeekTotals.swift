import RideStrava
import SwiftUI

struct CalendarWeekTotals: View {
  let totals: CalendarRange.PlannedAgainstCompleted

  private enum Kind: CaseIterable {
    case time, distance, load
  }

  var body: some View {
    let kinds = Kind.allCases.filter { meter($0).done > 0 || meter($0).planned > 0 }
    if kinds.isEmpty {
      Text("Nothing planned or done").font(.caption).foregroundStyle(.secondary)
    } else {
      Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 4) {
        ForEach(kinds, id: \.self) { kind in
          let meter = meter(kind)
          GridRow {
            Text(name(kind)).foregroundStyle(.secondary)
            bar(meter).frame(width: 120, height: 6)
            HStack(spacing: 3) {
              Text(figure(kind, meter.done))
              if meter.planned > 0 {
                Text("of \(figure(kind, meter.planned))").foregroundStyle(.secondary)
              }
            }
            .monospacedDigit()
          }
        }
      }
      .font(.caption)
      .accessibilityElement(children: .combine)
    }
  }

  private func meter(_ kind: Kind) -> CalendarMeter {
    switch kind {
    case .time: CalendarMeter(done: totals.completed.seconds, planned: totals.planned.seconds)
    case .distance: CalendarMeter(done: totals.completed.meters, planned: totals.planned.meters)
    case .load: CalendarMeter(done: totals.completed.load, planned: totals.planned.load)
    }
  }

  private func name(_ kind: Kind) -> String {
    switch kind {
    case .time: "Time"
    case .distance: "Distance"
    case .load: "Load"
    }
  }

  private func figure(_ kind: Kind, _ value: Double) -> String {
    switch kind {
    case .time: CalendarFigures.hours(value)
    case .distance: CalendarFigures.distance(value)
    case .load: "\(CalendarFigures.load(value)) TSS"
    }
  }

  private func bar(_ meter: CalendarMeter) -> some View {
    Capsule()
      .fill(.quaternary)
      .overlay(alignment: .leading) {
        Capsule().fill(Color.accentColor).scaleEffect(x: meter.fill, anchor: .leading)
      }
      .overlay(alignment: .leading) {
        if let mark = meter.mark {
          Rectangle().fill(.primary).frame(width: 2)
            .offset(x: 120 * mark - 1)
        }
      }
  }
}
