import RideData
import SwiftUI

/// Today's suggestions for wide windows: the selected one large, with Start ride on it, and
/// the others beside it. Click a smaller card to make it the large one, double-click to start
/// it.
struct TodayCards: View {
  let suggestions: [TodaySuggestion]
  @Binding var state: TodayState
  @Binding var minutes: Int
  let openSettings: () -> Void
  @Environment(RideLauncher.self) private var launcher
  @Environment(RiderSettingsStore.self) private var settings
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        TodayHeader()
        TodayTimePicker(minutes: $minutes, shuffle: shuffle)
        if let featured = suggestions.indices.contains(state.selection)
          ? suggestions[state.selection] : suggestions.first
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
        template: suggestion.template, tag: suggestion.tag, profileHeight: 80,
        isSelected: false, select: { feature(suggestion) },
        start: settings.ftp.map { ftp in
          {
            launcher.start(suggestion.template, ftp: ftp, heartRateZones: settings.heartRateZones)
          }
        })
    }
  }

  private func feature(_ suggestion: TodaySuggestion) {
    guard let index = suggestions.firstIndex(where: { $0.id == suggestion.id }) else { return }
    withAnimation(reduceMotion ? nil : .smooth) { state.selection = index }
  }

  private func shuffle() { state.shuffle += 1 }
}
