import RideBluetooth
import RideData
import SwiftUI

struct TodayView: View {
  @Binding var state: TodayState
  let openSettings: () -> Void
  @AppStorage("today.minutes") private var minutes = 30
  @Environment(AccountCalendar.self) private var calendar
  @Environment(\.syncCalendar) private var syncCalendar
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif

  var body: some View {
    let suggestions = TodaySuggestion.suggestions(minutes: minutes, shuffle: state.shuffleCount)
    let plan = TodayPlan(calendar: calendar)
    Group {
      if isWide {
        TodayCards(
          suggestions: suggestions, plan: plan, state: $state, minutes: $minutes,
          openSettings: openSettings
        )
        .toolbar {
          ToolbarItem(placement: .primaryAction) {
            if let planned = plan?.firstToStart {
              StartButton(
                workout: planned.playable, title: "Start \(planned.title)",
                planned: calendar.ride(of: planned)
              )
              .labelStyle(.titleAndIcon)
              .buttonStyle(.borderedProminent)
            } else {
              let selected =
                suggestions.indices.contains(state.selectedIndex)
                ? suggestions[state.selectedIndex] : suggestions.first
              StartButton(
                template: selected?.template,
                title: selected.map { "Start \($0.template.name)" } ?? "Start"
              )
              .labelStyle(.titleAndIcon)
              .buttonStyle(.borderedProminent)
            }
          }
          #if os(iOS)
            .visibilityPriority(.high)
          #endif
        }
      } else {
        TodayList(
          suggestions: suggestions, plan: plan, state: $state, minutes: $minutes,
          openSettings: openSettings)
      }
    }
    .plannedItemActions()
    .task { syncCalendar() }
    .navigationTitle("Today")
    .devicesToolbar()
  }

  private var isWide: Bool {
    #if os(iOS)
      sizeClass == .regular
    #else
      true
    #endif
  }
}

#Preview {
  @Previewable @State var state = TodayState()
  NavigationStack {
    TodayView(state: $state) {}
  }
  .environment(RideLauncher(simulated: true))
  .environment(RiderSettingsStore.sample)
  .environment(BluetoothDevices.sample())
  .environment(AccountCalendar())
  .frame(width: 900, height: 640)
}
