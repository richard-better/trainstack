import RideData
import SwiftUI

struct TodayList: View {
  let suggestions: [TodaySuggestion]
  let plan: TodayPlan?
  @Binding var state: TodayState
  @Binding var minutes: Int
  let openSettings: () -> Void
  @Environment(RiderSettingsStore.self) private var settings

  var body: some View {
    List {
      if let plan { TodayPlanSection(plan: plan) }
      Section {
        if let pick = suggestions.first {
          TodayPickCard(suggestion: pick)
          pickStart(pick)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .font(.headline)
            .listRowSeparator(.hidden)
            .padding(.bottom, 6)
        }
      } header: {
        VStack(alignment: .leading, spacing: 14) {
          if plan == nil {
            TodayHeader(isCompact: true)
          } else {
            Text("Or pick how long you have").font(.headline)
          }
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
              detail: "\(suggestion.kindOfDay) · \(suggestion.template.shortSummary)")
          }
        }
      }
    }
    #if os(iOS)
      .listStyle(.insetGrouped)
      .listSectionSpacing(.compact)
    #endif
  }

  @ViewBuilder private func pickStart(_ pick: TodaySuggestion) -> some View {
    let button = StartButton(
      template: pick.template, title: "Start ride", fillsWidth: true,
      isDefaultAction: plan?.firstToStart == nil)
    if plan?.firstToStart == nil {
      button.buttonStyle(.borderedProminent)
    } else {
      button.buttonStyle(.bordered)
    }
  }

  private func shuffle() { state.shuffleCount += 1 }
}
