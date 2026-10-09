import SwiftUI

#if os(iOS)
  /// The ride in progress, shown above the tab bar while the player is minimised, like the
  /// track playing in Music. Tap it to go back to the player.
  struct RideAccessory: View {
    let controller: RideController
    let open: () -> Void
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
      RideAccessoryContent(controller: controller, isInline: placement == .inline, open: open)
        .padding(.horizontal, 16)
    }
  }
#endif
