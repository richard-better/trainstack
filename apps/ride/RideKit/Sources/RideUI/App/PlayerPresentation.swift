import SwiftUI

/// Shows the ride in progress. The player covers the app, and the rider can minimise it: on
/// iOS to an accessory above the tab bar, on macOS to a bar over the bottom of the window, while
/// the ride carries on.
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
              PlayerView(controller: ride, onMinimize: minimize, onEnd: end)
            }
            .navigationTransition(.zoom(sourceID: "player", in: namespace))
          }
        }
    #else
      if let ride = launcher.ride, launcher.isPlayerPresented {
        NavigationStack {
          PlayerView(controller: ride, onMinimize: minimize, onEnd: end)
        }
      } else {
        content
          .contentMargins(.bottom, launcher.ride == nil ? 0 : RideBar.height, for: .scrollContent)
          .overlay(alignment: .bottom) {
            if let ride = launcher.ride {
              RideBar(controller: ride, open: show)
            }
          }
      }
    #endif
  }

  /// Ends the ride, and saves it unless it was thrown away or never got going.
  private func end(saving: Bool) {
    launcher.end(saveTo: saving ? library : nil)
  }

  private func minimize() { launcher.isPlayerPresented = false }

  #if os(macOS)
    private func show() { launcher.isPlayerPresented = true }
  #endif
}
