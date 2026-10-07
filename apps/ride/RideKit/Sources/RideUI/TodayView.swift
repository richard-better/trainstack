import RideData
import SwiftUI

/// What to ride today: three suggestions, each a different kind of day, sized to the time the
/// rider has.
struct TodayView: View {
  let openSettings: () -> Void
  @Environment(RideLauncher.self) private var launcher
  @Environment(RiderProfileStore.self) private var profile
  @AppStorage("today.minutes") private var minutes = 30
  @State private var shuffle = 0
  @State private var selection = 0

  static let durations = [30, 45, 60, 75, 90, 120]

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        header
        HStack(spacing: 10) {
          Picker("Time you have", selection: $minutes) {
            ForEach(Self.durations, id: \.self) { Text("\($0)m").tag($0) }
          }
          .pickerStyle(.segmented)
          .labelsHidden()
          .fixedSize()
          Button("Other suggestions", systemImage: "shuffle") { shuffle += 1 }
            .labelStyle(.iconOnly)
            .help("Other suggestions")
        }
        .monospacedDigit()
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 14)], spacing: 14) {
          ForEach(Array(suggestions.enumerated()), id: \.offset) { index, suggestion in
            WorkoutCard(
              template: suggestion.template, tag: suggestion.tag, profileHeight: 120,
              isSelected: index == selection, select: { selection = index },
              start: profile.ftp.map { ftp in { launcher.start(suggestion.template, ftp: ftp) } })
          }
        }
        footnote
      }
      .padding(.horizontal, 32)
      .padding(.vertical, 28)
      .frame(maxWidth: 1100, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .navigationTitle("Today")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        let selected = suggestions[min(selection, suggestions.count - 1)].template
        StartButton(template: selected, title: "Start \(selected.name)")
      }
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide)))
        .foregroundStyle(.secondary)
      Text("Nothing planned")
        .font(.title.weight(.semibold))
      Text("Feel like riding? Pick how long you have.")
        .foregroundStyle(.secondary)
    }
  }

  @ViewBuilder private var footnote: some View {
    if profile.ftp == nil {
      HStack(spacing: 4) {
        Text("Workout targets are set from your FTP.")
        Button("Add it in Settings", action: openSettings)
          .inlineLinkStyle()
      }
      .font(.caption)
      .foregroundStyle(.secondary)
    } else {
      Text(startHint).font(.caption).foregroundStyle(.secondary)
    }
  }

  private var startHint: String {
    #if os(macOS)
      "Double-click a card to start it."
    #else
      "Double-tap a card to start it."
    #endif
  }

  private struct Suggestion {
    let tag: String
    let template: WorkoutTemplate
  }

  /// One workout from each kind of day, fitted to the chosen time. Shuffling moves every kind
  /// on to its next workout.
  private var suggestions: [Suggestion] {
    Self.kinds.map { tag, names in
      let templates = names.compactMap(WorkoutTemplate.named)
      let template = templates[shuffle % templates.count]
      return Suggestion(tag: tag, template: template.fitted(to: TimeInterval(minutes * 60)))
    }
  }

  private static let kinds: [(String, [String])] = [
    ("Fun pick", ["Pixel sprints 30", "Over-unders 2×10", "Zone 3 · 3×10"]),
    ("Easy day", ["Recovery 30", "Long endurance 90"]),
    ("Short and sharp", ["Ramp openers 30", "Tabata 4×40/20", "VO2 max booster"]),
  ]
}

#Preview {
  NavigationStack {
    TodayView {}
  }
  .environment(RideLauncher(simulated: true))
  .environment(RiderProfileStore.sample)
  .frame(width: 900, height: 640)
}

extension View {
  /// A button that reads as a link within a sentence.
  func inlineLinkStyle() -> some View {
    #if os(macOS)
      buttonStyle(.link)
    #else
      buttonStyle(.borderless)
    #endif
  }
}
