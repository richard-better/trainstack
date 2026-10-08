import RideData
import SwiftUI

/// Today on iPhone: one featured suggestion with Start ride on its card, and the others as
/// compact rows, so all of them fit above the tab bar.
struct TodayList: View {
  let suggestions: [TodaySuggestion]
  @Binding var state: TodayState
  @Binding var minutes: Int
  let openSettings: () -> Void
  @Environment(RiderSettingsStore.self) private var settings

  var body: some View {
    List {
      Section {
        if let pick = suggestions.first {
          TodayPickCard(suggestion: pick)
          StartButton(template: pick.template, title: "Start ride", fillsWidth: true)
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .font(.headline)
            .listRowSeparator(.hidden)
            .padding(.bottom, 6)
        }
      } header: {
        VStack(alignment: .leading, spacing: 14) {
          TodayHeader(isCompact: true)
          TodayTimePicker(minutes: $minutes, fillsWidth: true, shuffle: shuffle)
        }
        .foregroundStyle(.primary)
        .textCase(nil)
        .padding(.bottom, 8)
      } footer: {
        if settings.ftp == nil { TodayFootnote(openSettings: openSettings) }
      }
      Section("Other picks") {
        ForEach(suggestions.dropFirst()) { suggestion in
          NavigationLink(value: suggestion.template) {
            WorkoutRow(
              template: suggestion.template,
              detail: "\(suggestion.tag) · \(suggestion.template.shortSummary)")
          }
        }
      }
    }
    #if os(iOS)
      .listStyle(.insetGrouped)
      .listSectionSpacing(.compact)
    #endif
  }

  private func shuffle() { state.shuffle += 1 }
}
