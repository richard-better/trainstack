import SwiftUI

struct TodayPlanCards: View {
  let plan: TodayPlan

  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      if !plan.items.isEmpty {
        LazyVGrid(
          columns: [GridItem(.adaptive(minimum: 300), spacing: 14, alignment: .top)],
          alignment: .leading, spacing: 14
        ) {
          ForEach(plan.items) { item in
            TodayPlannedCard(item: item, isFirstToStart: item.id == plan.firstToStart?.id)
          }
        }
      }
      VStack(alignment: .leading, spacing: 10) {
        Text("Coming up").font(.headline)
        VStack(spacing: 0) {
          ForEach(plan.upcoming, id: \.day) { day in
            if day.day != plan.upcoming.first?.day { Divider() }
            TodayComingUpRow(day: day, today: plan.today)
              .padding(.vertical, 10)
          }
        }
        .padding(.horizontal, 16)
        .background(.primary.opacity(0.04), in: .rect(cornerRadius: 16))
      }
    }
  }
}
