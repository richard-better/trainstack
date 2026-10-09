import SwiftUI

/// Over the chart when the ride needs the rider's attention: it is paused, or the trainer is gone.
struct PlayerBadge: View {
  let message: String

  var body: some View {
    Text(message)
      .font(.headline)
      .multilineTextAlignment(.center)
      .padding(.horizontal, 16)
      .padding(.vertical, 8)
      .glassEffect(.regular, in: .rect(cornerRadius: 8))
  }

  static var paused: String {
    #if os(macOS)
      "Paused · press Space to resume"
    #else
      "Paused"
    #endif
  }
}
