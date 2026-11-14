import RideData
import RideStrava
import SwiftUI

struct CalendarWeekSection: View {
  let monday: SettingDay
  let today: SettingDay
  let isWide: Bool
  @Environment(AccountCalendar.self) private var calendar

  var body: some View {
    let days = (0..<7).map { offset in
      let day = monday.adding(days: offset)
      return calendar.day(day) ?? CalendarRange.Day(day: day)
    }
    VStack(alignment: .leading, spacing: 12) {
      ViewThatFits(in: .horizontal) {
        HStack(alignment: .firstTextBaseline, spacing: 24) {
          title
          Spacer(minLength: 0)
          totals
        }
        VStack(alignment: .leading, spacing: 8) {
          title
          totals
        }
      }
      if isWide {
        LazyVGrid(
          columns: Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: 7),
          alignment: .leading
        ) {
          ForEach(days, id: \.day) { day in
            CalendarDayView(day: day, today: today, isColumn: true)
          }
        }
      } else {
        VStack(alignment: .leading, spacing: 14) {
          ForEach(days, id: \.day) { day in
            CalendarDayView(day: day, today: today, isColumn: false)
          }
        }
      }
    }
  }

  private var title: some View {
    Text(CalendarWeekName.of(monday, today: today))
      .font(.title3.bold())
      .accessibilityAddTraits(.isHeader)
  }

  private var totals: some View {
    CalendarWeekTotals(
      totals: calendar.week(startingOn: monday)?.totals ?? CalendarRange.PlannedAgainstCompleted())
  }
}
