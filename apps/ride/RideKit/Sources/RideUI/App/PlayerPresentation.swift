import SwiftUI

struct PlayerPresentation: ViewModifier {
  @Bindable var launcher: RideLauncher
  let library: RideLibrary
  let namespace: Namespace.ID

  func body(content: Content) -> some View {
    #if os(iOS)
      content
        .fullScreenCover(isPresented: $launcher.isPlayerPresented) {
          if let ride = launcher.ride {
            NavigationStack {
              PlayerView(
                controller: ride, isConfirmingEnd: $launcher.isConfirmingEnd,
                onMinimize: minimize, onEnd: end)
            }
            .navigationTransition(.zoom(sourceID: "player", in: namespace))
          }
        }
    #else
      if let ride = launcher.ride, launcher.isPlayerPresented {
        NavigationStack {
          PlayerView(
            controller: ride, isConfirmingEnd: $launcher.isConfirmingEnd, onMinimize: minimize,
            onEnd: end)
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

  private func end(saving: Bool) {
    launcher.end(saveTo: saving ? library : nil)
  }

  private func minimize() { launcher.isPlayerPresented = false }

  #if os(macOS)
    private func show() { launcher.isPlayerPresented = true }
  #endif
}
