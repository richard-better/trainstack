import RideData
import SwiftUI

/// What to ride today: three suggestions, each a different kind of day, sized to the time the
/// rider has.
struct TodayView: View {
  @Binding var state: TodayState
  let openSettings: () -> Void
  @Environment(RideLauncher.self) private var launcher
  @Environment(RiderSettingsStore.self) private var settings
  @AppStorage("today.minutes") private var minutes = 30

  static let durations = [30, 45, 60, 75, 90, 120]

  var body: some View {
    let suggestions = TodaySuggestion.suggestions(minutes: minutes, shuffle: state.shuffle)
    let selected =
      suggestions.indices.contains(state.selection)
      ? suggestions[state.selection] : suggestions.first
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        TodayHeader()
        // The time picker at its natural width when there's room, otherwise sharing the row.
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 10) {
            timePicker.fixedSize()
            shuffleButton
          }
          HStack(spacing: 10) {
            timePicker
            shuffleButton
          }
        }
        .monospacedDigit()
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
      .padding(.horizontal, 32)
      .padding(.vertical, 28)
      .frame(maxWidth: 1100, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .navigationTitle("Today")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        StartButton(
          template: selected?.template,
          title: selected.map { "Start \($0.template.name)" } ?? "Start")
      }
    }
  }

  private var timePicker: some View {
    Picker("Time you have", selection: $minutes) {
      ForEach(Self.durations, id: \.self) { Text("\($0)m").tag($0) }
    }
    .pickerStyle(.segmented)
    .labelsHidden()
  }

  private var shuffleButton: some View {
    Button("Other suggestions", systemImage: "shuffle", action: shuffle)
      .labelStyle(.iconOnly)
      .buttonStyle(.glass)
      #if os(iOS)
        .controlSize(.large)
      #endif
      .help("Other suggestions")
  }

  private func shuffle() { state.shuffle += 1 }
}

#Preview {
  @Previewable @State var state = TodayState()
  NavigationStack {
    TodayView(state: $state) {}
  }
  .environment(RideLauncher(simulated: true))
  .environment(RiderSettingsStore.sample)
  .frame(width: 900, height: 640)
}
