import RideStrava
import SwiftUI

struct AccountActivityRow: View {
  let activity: AccountActivity
  var isOnStrava = false

  var body: some View {
    let fractions = activity.zoneFractions
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Image(systemName: activity.symbol)
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .accessibilityLabel(activity.sportName)
        Text(activity.title).font(.headline).lineLimit(1)
        if isOnStrava {
          Image(systemName: "checkmark.circle.fill")
            .font(.caption)
            .foregroundStyle(.secondary)
            .accessibilityLabel("On Strava")
        }
        Spacer(minLength: 0)
        if let date = activity.date {
          Text(date, format: .dateTime.day().weekday(.abbreviated))
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
      Text(figures)
        .font(.caption.monospacedDigit())
        .foregroundStyle(.secondary)
      if !fractions.isEmpty {
        ZoneBar(fractions: fractions).frame(height: 4)
      }
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }

  private var figures: String {
    let figures = activity.rowFigures
    if !figures.isEmpty { return figures.joined(separator: "  ") }
    return activity.isSummarized ? activity.sportName : "Not summarised yet"
  }
}
