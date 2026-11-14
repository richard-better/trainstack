import RideData
import RideStrava
import SwiftUI

struct CalendarDayView: View {
  let day: CalendarRange.Day
  let today: SettingDay
  let isColumn: Bool

  var body: some View {
    let pairs = CalendarDayPairs(day)
    let isEmpty = pairs.planned.isEmpty && pairs.unplanned.isEmpty
    Group {
      if isColumn {
        VStack(alignment: .leading, spacing: 6) {
          header
          items(pairs)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
      } else {
        HStack(alignment: .top, spacing: 12) {
          header.frame(width: 52, alignment: .leading)
          VStack(alignment: .leading, spacing: 6) {
            if isEmpty {
              Text("Nothing planned").font(.caption).foregroundStyle(.tertiary)
                .padding(.top, 2)
            }
            items(pairs)
          }
        }
      }
    }
  }

  private var header: some View {
    let isToday = day.day == today
    return VStack(alignment: .leading, spacing: 0) {
      Text(day.day.displayDate, format: .dateTime.weekday(.abbreviated))
        .font(.caption.weight(.semibold))
        .foregroundStyle(isToday ? Color.accentColor : .secondary)
      Text(day.day.displayDate, format: .dateTime.day())
        .font(.title3.weight(isToday ? .bold : .regular))
        .foregroundStyle(isToday ? Color.accentColor : .primary)
        .monospacedDigit()
    }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(isToday ? .isHeader : [])
  }

  @ViewBuilder private func items(_ pairs: CalendarDayPairs) -> some View {
    ForEach(pairs.planned) { CalendarPlannedCard(entry: $0) }
    ForEach(pairs.unplanned) { CalendarActivityCard(activity: $0) }
  }
}
