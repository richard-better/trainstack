import SwiftUI

/// What the rider needs to set in Settings for something to show.
struct MissingSetting: View {
  let message: LocalizedStringKey

  init(_ message: LocalizedStringKey) { self.message = message }

  var body: some View {
    Label(message, systemImage: "gearshape")
      .font(.callout)
      .foregroundStyle(.secondary)
      .padding(.vertical, 8)
  }
}
