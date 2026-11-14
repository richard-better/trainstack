import RideStrava
import SwiftUI

struct CalendarActivityCard: View {
  let activity: CalendarActivity

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Label {
        Text(activity.title)
          .font(.subheadline.weight(.semibold))
          .lineLimit(3)
          .fixedSize(horizontal: false, vertical: true)
      } icon: {
        Image(systemName: activity.symbol).foregroundStyle(.secondary)
      }
      Text(activity.summary)
        .foregroundStyle(.secondary)
        .monospacedDigit()
      Label("Unplanned", systemImage: "checkmark.circle")
        .foregroundStyle(.secondary)
    }
    .font(.caption)
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(10)
    .background(.primary.opacity(0.04), in: .rect(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(.separator, lineWidth: 1) }
    .accessibilityElement(children: .combine)
  }
}
