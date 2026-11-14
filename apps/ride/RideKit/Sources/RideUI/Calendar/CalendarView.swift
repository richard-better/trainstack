import RideData
import SwiftUI

struct CalendarView: View {
  @Environment(AccountCalendar.self) private var calendar
  @Environment(TrainStackAccount.self) private var account
  @Environment(\.syncCalendar) private var syncCalendar
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif

  var body: some View {
    Group {
      if calendar.isShowing, let today = calendar.today, let window = calendar.window {
        weeks(today: today, window: window)
      } else {
        ContentUnavailableView {
          Label("No Calendar Yet", systemImage: "calendar")
        } description: {
          Text(
            account.isSignedIn
              ? "Ride is reading your TrainStack calendar."
              : "Sign in to TrainStack in Settings to see the workouts you plan on the web.")
        }
      }
    }
    .plannedItemActions()
    .navigationTitle("Calendar")
    .task { syncCalendar() }
  }

  private func weeks(today: SettingDay, window: CalendarWindow) -> some View {
    let mondays = stride(from: 0, through: window.from.days(until: window.through), by: 7).map {
      window.from.adding(days: $0)
    }
    return ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 32) {
          ForEach(mondays, id: \.self) { monday in
            CalendarWeekSection(monday: monday, today: today, isWide: isWide)
              .id(monday)
          }
          Text("Ride keeps four weeks either side of today. Plan and see further on the web.")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        .pageLayout(maxWidth: isWide ? Design.pageWidth : Design.ridePageWidth)
      }
      .refreshable { syncCalendar() }
      .onAppear { proxy.scrollTo(today.monday, anchor: .top) }
      .onChange(of: today) { _, today in proxy.scrollTo(today.monday, anchor: .top) }
    }
  }

  private var isWide: Bool {
    #if os(iOS)
      sizeClass == .regular
    #else
      true
    #endif
  }
}
