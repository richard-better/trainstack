import SwiftUI

/// Shows the ride in progress. On iOS the player covers the app and minimises to an accessory
/// above the tab bar; on macOS it takes over the window until the ride ends.
struct PlayerPresentation: ViewModifier {
  @Bindable var launcher: RideLauncher
  /// Where a saved ride goes.
  let library: RideLibrary
  /// Where the player zooms from and back to when it opens and minimises.
  let namespace: Namespace.ID

  func body(content: Content) -> some View {
    #if os(iOS)
      content
        .fullScreenCover(isPresented: $launcher.isPlayerPresented) {
          if let ride = launcher.ride {
            NavigationStack {
              PlayerView(controller: ride, onEnd: end)
            }
            .navigationTransition(.zoom(sourceID: "player", in: namespace))
          }
        }
    #else
      if let ride = launcher.ride {
        NavigationStack {
          PlayerView(controller: ride, onEnd: end)
        }
      } else {
        content
      }
    #endif
  }

  /// Ends the ride, and saves it unless it was thrown away or never got going.
  private func end(saving: Bool) {
    let recording = launcher.end()
    if saving, let recording, !recording.samples.isEmpty { library.save(recording) }
  }
}
