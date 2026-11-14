import RideStrava
import SwiftUI

struct TodayPlanSection: View {
  let plan: TodayPlan
  @Environment(RiderSettingsStore.self) private var settings

  var body: some View {
    Section {
      if plan.items.isEmpty {
        Text("Nothing on the calendar for today.")
          .foregroundStyle(.secondary)
      }
      ForEach(plan.items) { item in
        NavigationLink(value: PlannedItemRoute(id: item.id)) {
          PlannedItemRow(item: item, ftp: settings.ftp)
        }
        if item.canStart {
          start(item)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .font(.headline)
            .listRowSeparator(.hidden)
            .padding(.bottom, 6)
        }
      }
    } header: {
      TodayHeader(isCompact: true, plan: plan)
        .foregroundStyle(.primary)
        .textCase(nil)
        .padding(.bottom, 8)
    }
    Section("Coming up") {
      ForEach(plan.upcoming, id: \.day) { day in
        TodayComingUpRow(day: day, today: plan.today)
      }
      NavigationLink("Calendar", value: CalendarRoute())
    }
  }

  @ViewBuilder private func start(_ item: PlannedItem) -> some View {
    let button = StartButton(
      workout: item.playable, title: "Start \(item.title)", fillsWidth: true,
      isDefaultAction: item.id == plan.firstToStart?.id)
    if item.id == plan.firstToStart?.id {
      button.buttonStyle(.borderedProminent)
    } else {
      button.buttonStyle(.bordered)
    }
  }
}
