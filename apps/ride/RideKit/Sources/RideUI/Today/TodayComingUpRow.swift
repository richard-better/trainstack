import RideData
import RideStrava
import SwiftUI

struct TodayComingUpRow: View {
  let day: CalendarRange.Day
  let today: SettingDay

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      Text(TodayDayName.of(day.day, today: today))
        .font(.subheadline.weight(.semibold))
        .frame(width: 84, alignment: .leading)
      VStack(alignment: .leading, spacing: 4) {
        if day.planned.isEmpty {
          Text("Nothing planned").foregroundStyle(.secondary)
        }
        ForEach(day.planned) { item in
          Label {
            VStack(alignment: .leading, spacing: 1) {
              Text(item.title)
              if item.isWorkout {
                Text(item.summary)
                  .font(.footnote)
                  .foregroundStyle(.secondary)
                  .monospacedDigit()
              }
            }
          } icon: {
            Image(systemName: item.symbol).foregroundStyle(.secondary)
          }
        }
      }
      .font(.subheadline)
      Spacer(minLength: 0)
    }
    .accessibilityElement(children: .combine)
  }
}
