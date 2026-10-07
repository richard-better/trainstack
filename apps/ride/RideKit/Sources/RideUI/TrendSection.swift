import Charts
import RideData
import SwiftUI

/// Fitness day by day over the chosen span, over each week's average daily stress. Its span
/// is chosen in the toolbar, and changing it redraws only this section.
struct TrendSection: View {
  let load: [TrainingLoad]
  @State private var span = ProgressSpan.sixMonths
  @Environment(\.calendar) private var calendar

  var body: some View {
    let shown = Array(load.suffix(span.days))
    let weeks = Dictionary(grouping: shown) {
      calendar.dateInterval(of: .weekOfYear, for: $0.date)?.start ?? $0.date
    }
    .map { WeeklyStress(start: $0.key, dailyStress: $0.value.reduce(0) { $0 + $1.stress } / 7) }
    let legend = HStack(spacing: 16) {
      LegendSwatch(title: "Fitness", color: .primary, height: 2)
      LegendSwatch(title: "Stress per day, by week", color: .primary.opacity(0.25), height: 10)
    }
    let explanation = Text("Fitness is your load over 6 weeks. Fatigue is the last 7 days.")
    VStack(alignment: .leading, spacing: 8) {
      ViewThatFits(in: .horizontal) {
        HStack {
          legend
          Spacer()
          explanation
        }
        VStack(alignment: .leading, spacing: 4) {
          legend
          explanation
        }
      }
      .font(.caption)
      .foregroundStyle(.secondary)
      Chart {
        ForEach(weeks) { week in
          BarMark(
            x: .value("Week", week.start, unit: .weekOfYear),
            y: .value("Stress", week.dailyStress)
          )
          .foregroundStyle(Color.primary.opacity(0.25))
        }
        ForEach(shown) { day in
          LineMark(x: .value("Day", day.date, unit: .day), y: .value("Fitness", day.fitness))
            .foregroundStyle(Color.primary)
            .lineStyle(StrokeStyle(lineWidth: 2, lineJoin: .round))
        }
      }
      .chartYAxis {
        AxisMarks(values: .automatic(desiredCount: 4)) { _ in
          AxisGridLine().foregroundStyle(.quaternary)
          AxisValueLabel()
        }
      }
      .chartXAxis {
        AxisMarks(values: .stride(by: span == .sixWeeks ? .weekOfYear : .month)) { _ in
          AxisValueLabel(
            format: span == .sixWeeks ? .dateTime.day().month(.abbreviated) : .dateTime.month())
        }
      }
      .frame(height: 190)
    }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Picker("Period", selection: $span) {
          ForEach(ProgressSpan.allCases, id: \.self) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
        .fixedSize()
      }
    }
  }
}
