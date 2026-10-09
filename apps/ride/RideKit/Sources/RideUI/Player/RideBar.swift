import SwiftUI

#if os(macOS)
  /// The ride in progress, floating over the bottom of the window while the player is minimised.
  /// Click it to go back to the player.
  struct RideBar: View {
    let controller: RideController
    let open: () -> Void

    /// The room the bar takes at the bottom of the window, which scrolling pages leave free.
    static let height = 64.0

    var body: some View {
      RideAccessoryContent(controller: controller, open: open)
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .frame(maxWidth: 420)
        .glassEffect(.regular.interactive(), in: .capsule)
        .padding(.bottom, 8)
    }
  }
#endif
