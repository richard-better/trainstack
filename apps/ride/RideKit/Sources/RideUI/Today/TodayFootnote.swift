import SwiftUI

/// How to start a suggestion, or without an FTP, that one is needed and where to add it.
struct TodayFootnote: View {
  let openSettings: () -> Void
  @Environment(RiderSettingsStore.self) private var settings

  var body: some View {
    Group {
      if settings.ftp == nil {
        HStack(spacing: 4) {
          Text("Workout targets are set from your FTP.")
          Button("Add it in Settings", action: openSettings)
            .inlineLinkStyle()
        }
      } else {
        Text(startHint)
      }
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }

  private var startHint: String {
    #if os(macOS)
      "Double-click a card to start it."
    #else
      "Double-tap a card to start it."
    #endif
  }
}
