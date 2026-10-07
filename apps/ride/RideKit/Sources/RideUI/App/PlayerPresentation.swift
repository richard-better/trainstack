import SwiftUI

/// Shows the ride in progress. On iOS the player covers the app and minimises to an accessory
/// above the tab bar; on macOS it takes over the window until the ride ends.
struct PlayerPresentation: ViewModifier {
  @Bindable var launcher: RideLauncher
  /// Where the player zooms from and back to when it opens and minimises.
  let namespace: Namespace.ID

  func body(content: Content) -> some View {
    #if os(iOS)
      content
        .fullScreenCover(isPresented: $launcher.isPlayerPresented) {
          if let ride = launcher.ride {
            NavigationStack {
              PlayerView(controller: ride, onEnd: launcher.end)
            }
            .navigationTransition(.zoom(sourceID: "player", in: namespace))
          }
        }
    #else
      if let ride = launcher.ride {
        NavigationStack {
          PlayerView(controller: ride, onEnd: launcher.end)
        }
      } else {
        content
      }
    #endif
  }
}
