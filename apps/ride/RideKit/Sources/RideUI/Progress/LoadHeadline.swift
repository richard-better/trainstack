import RideData
import SwiftUI

/// Today's fitness, fatigue and form, and this week's riding. One row when it fits, otherwise
/// two.
struct LoadHeadline: View {
  let load: [TrainingLoad]
  let rides: [RideRecording]

  var body: some View {
    let now = load.last
    let monthAgo = load.dropLast(28).last
    let change = Int(((now?.fitness ?? 0) - (monthAgo?.fitness ?? 0)).rounded())
    let fitness = HeadlineStat(label: "Fitness", swatch: .primary) {
      Text(Self.rounded(now?.fitness))
      Text("\(Self.signed(change)) in 4 weeks").font(.subheadline).foregroundStyle(.secondary)
    }
    let fatigue = HeadlineStat(label: "Fatigue") {
      Text(Self.rounded(now?.fatigue))
    }
    let form = HeadlineStat(label: "Form") {
      Text(Self.signed(Int((now?.form ?? 0).rounded())))
      FormBadge(form: now?.form ?? 0)
    }
    let thisWeek = ThisWeekStat(rides: rides)
    ViewThatFits(in: .horizontal) {
      DividedRow(spacing: 16) {
        fitness
        fatigue
        form
        thisWeek
      }
      Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 0) {
        GridRow {
          fitness
          fatigue
        }
        GridRow {
          form
          thisWeek
        }
      }
    }
    .overlay(alignment: .top) { Divider() }
    .overlay(alignment: .bottom) { Divider() }
  }

  private static func rounded(_ value: Double?) -> String {
    value.map { "\(Int($0.rounded()))" } ?? "—"
  }

  private static func signed(_ value: Int) -> String {
    value > 0 ? "+\(value)" : value < 0 ? "−\(-value)" : "0"
  }
}
