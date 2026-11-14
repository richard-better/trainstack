import SwiftUI

struct PlayerCue: View {
  let banner: PlayerBanner

  var body: some View {
    ViewThatFits(in: .horizontal) {
      label(.largeTitle.weight(.bold)).lineLimit(1)
      label(.title.weight(.bold)).lineLimit(1)
      label(.title2.weight(.bold)).lineLimit(3)
    }
    .multilineTextAlignment(.center)
    .padding(.horizontal, 18)
    .padding(.vertical, 10)
    .glassEffect(.regular, in: .rect(cornerRadius: 14))
    .padding(.top, 8)
    .padding(.horizontal, 8)
    .accessibilityAddTraits(.updatesFrequently)
    .onChange(of: banner.text, initial: true) { _, text in
      AccessibilityNotification.Announcement(text).post()
    }
  }

  private func label(_ font: Font) -> some View {
    Label(banner.text, systemImage: banner.systemImage)
      .font(font)
  }
}

#Preview("Cue") {
  PlayerCue(banner: PlayerBanner(kind: .cue, text: "Block 1 of 3. Steady, you could still talk"))
    .frame(width: 390)
}

#Preview("Upcoming") {
  PlayerCue(banner: PlayerBanner(kind: .upcoming, text: "Next: Threshold · 250 W · for 10:00"))
    .frame(width: 1000)
}
