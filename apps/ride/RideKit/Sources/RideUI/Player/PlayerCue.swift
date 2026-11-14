import SwiftUI

struct PlayerCue: View {
  let text: String

  var body: some View {
    Label(text, systemImage: "text.bubble")
      .font(.title3.weight(.semibold))
      .multilineTextAlignment(.center)
      .padding(.horizontal, 16)
      .padding(.vertical, 8)
      .glassEffect(.regular, in: .rect(cornerRadius: 10))
      .padding(.top, 8)
      .accessibilityAddTraits(.updatesFrequently)
  }
}
