import RideData
import SwiftUI

/// Today's suggestions as cards side by side, for wide windows. Click a card to select it,
/// double-click to start it.
struct TodayCards: View {
  let suggestions: [TodaySuggestion]
  @Binding var state: TodayState
  @Binding var minutes: Int
  let openSettings: () -> Void
  @Environment(RideLauncher.self) private var launcher
  @Environment(RiderSettingsStore.self) private var settings

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        TodayHeader()
        TodayTimePicker(minutes: $minutes, shuffle: shuffle)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 14)], spacing: 14) {
          ForEach(suggestions.enumerated(), id: \.element.id) { index, suggestion in
            WorkoutCard(
              template: suggestion.template, tag: suggestion.tag, profileHeight: 120,
              isSelected: index == state.selection, select: { state.selection = index },
              start: settings.ftp.map { ftp in { launcher.start(suggestion.template, ftp: ftp) } })
          }
        }
        TodayFootnote(openSettings: openSettings)
      }
      .pageLayout()
    }
  }

  private func shuffle() { state.shuffle += 1 }
}
