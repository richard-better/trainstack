import RideStrava
import SwiftUI

struct CalendarPlannedCard: View {
  let entry: CalendarDayPairs.Entry

  var body: some View {
    let item = entry.item
    NavigationLink(value: PlannedItemRoute(id: item.id)) {
      VStack(alignment: .leading, spacing: 4) {
        Label {
          Text(item.title)
            .font(.subheadline.weight(.semibold))
            .strikethrough(item.state == .skipped)
            .lineLimit(3)
            .fixedSize(horizontal: false, vertical: true)
        } icon: {
          Image(systemName: item.symbol).foregroundStyle(.secondary)
        }
        if item.isWorkout {
          Text(item.summary)
            .foregroundStyle(.secondary)
            .monospacedDigit()
        }
        PlannedItemStateLabel(item: item)
        if let done = entry.done {
          Text(
            "\(item.pairing?.by == .athlete ? "Paired by you" : "Matched"): \(done.title), \(done.summary)"
          )
          .foregroundStyle(.secondary)
          .monospacedDigit()
        }
        if let words = ComplianceWords(item) {
          ComplianceBadge(words: words)
        }
        if let notes = item.notes {
          Text(notes)
            .foregroundStyle(.secondary)
            .lineLimit(2)
        }
      }
      .font(.caption)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(10)
      .background(.primary.opacity(0.04), in: .rect(cornerRadius: 12))
      .overlay { border(item.state) }
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .contextMenu { PlannedItemMenu(item: entry.item) }
  }

  @ViewBuilder private func border(_ state: PlannedItem.State) -> some View {
    let shape = RoundedRectangle(cornerRadius: 12)
    switch state {
    case .planned:
      shape.strokeBorder(
        Color.accentColor.opacity(0.7), style: StrokeStyle(lineWidth: 1.5, dash: [5, 3]))
    case .completed:
      shape.strokeBorder(Color.green.opacity(0.7), lineWidth: 1.5)
    case .skipped:
      shape.strokeBorder(
        Color.secondary.opacity(0.6), style: StrokeStyle(lineWidth: 1.5, dash: [1, 3]))
    case .missed:
      shape.strokeBorder(Color.orange.opacity(0.8), lineWidth: 1.5)
    }
  }
}
