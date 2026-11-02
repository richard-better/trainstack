import SwiftUI

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
