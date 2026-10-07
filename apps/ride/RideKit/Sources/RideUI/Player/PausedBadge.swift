import SwiftUI

/// Over the chart while the ride is paused.
struct PausedBadge: View {
  var body: some View {
    Text(message)
      .font(.headline)
      .padding(.horizontal, 16)
      .padding(.vertical, 8)
      .glassEffect(.regular, in: .rect(cornerRadius: 8))
  }

  private var message: String {
    #if os(macOS)
      "Paused · press Space to resume"
    #else
      "Paused"
    #endif
  }
}
