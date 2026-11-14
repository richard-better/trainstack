import RideStrava
import SwiftUI

struct PlannedItemRow: View {
  let item: PlannedItem
  let ftp: Int?
  @ScaledMetric private var profileHeight = 36.0

  var body: some View {
    HStack(spacing: 12) {
      PlannedItemThumbnail(item: item, ftp: ftp)
        .frame(width: profileHeight * 2.1, height: profileHeight)
        .overlay(alignment: .bottom) { Rectangle().fill(.separator).frame(height: 1) }
        .opacity(item.state == .skipped ? 0.4 : 1)
      VStack(alignment: .leading, spacing: 2) {
        Text(item.title)
          .font(.body.weight(.semibold))
          .strikethrough(item.state == .skipped)
        Text(item.summary)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .monospacedDigit()
        PlannedItemStateLabel(item: item)
          .font(.footnote)
        if item.state != .completed, let why = item.whyItCannotBeRidden {
          Label(why, systemImage: "exclamationmark.circle")
            .font(.footnote)
            .foregroundStyle(.orange)
        }
        if let notes = item.notes {
          Text(notes)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(3)
        }
      }
    }
    .padding(.vertical, 1)
    .accessibilityElement(children: .combine)
  }
}
