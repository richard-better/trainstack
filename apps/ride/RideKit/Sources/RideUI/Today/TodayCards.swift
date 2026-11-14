import RideData
import SwiftUI

struct TodayCards: View {
  let suggestions: [TodaySuggestion]
  let plan: TodayPlan?
  @Binding var state: TodayState
  @Binding var minutes: Int
  @Environment(\.openWorkout) private var openWorkout
  let openSettings: () -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        TodayHeader(plan: plan)
        if let plan {
          TodayPlanCards(plan: plan)
          Text("Or pick how long you have").font(.title3.bold())
        }
        TodayTimePicker(minutes: $minutes, shuffle: shuffle)
        if let featured = suggestions.indices.contains(state.selectedIndex)
          ? suggestions[state.selectedIndex] : suggestions.first
        {
          let others = suggestions.filter { $0.id != featured.id }
          ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 14) {
              TodayHeroCard(suggestion: featured)
                .frame(minWidth: 420)
              VStack(spacing: 14) { cards(others) }
                .frame(width: 260)
            }
            VStack(spacing: 14) {
              TodayHeroCard(suggestion: featured)
              HStack(alignment: .top, spacing: 14) { cards(others) }
            }
          }
        }
        TodayFootnote(openSettings: openSettings)
      }
      .pageLayout()
    }
  }

  @ViewBuilder private func cards(_ suggestions: [TodaySuggestion]) -> some View {
    ForEach(suggestions) { suggestion in
      WorkoutCard(
        template: suggestion.template, tag: suggestion.kindOfDay, profileHeight: 80,
        isSelected: false, select: { feature(suggestion) },
        open: { openWorkout(suggestion.template) }, start: nil)
    }
  }

  private func feature(_ suggestion: TodaySuggestion) {
    guard let index = suggestions.firstIndex(where: { $0.id == suggestion.id }) else { return }
    withAnimation(reduceMotion ? nil : .smooth) { state.selectedIndex = index }
  }

  private func shuffle() { state.shuffleCount += 1 }
}
