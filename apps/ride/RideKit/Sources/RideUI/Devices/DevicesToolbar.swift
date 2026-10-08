import SwiftUI

extension View {
  /// The rider's devices at the trailing end of the navigation bar, each showing whether it is
  /// connected, and on iPhone a Devices button too. Either opens the Devices sheet. On iOS;
  /// macOS keeps Devices in Settings.
  func devicesToolbar() -> some View {
    modifier(DevicesToolbar())
  }
}

private struct DevicesToolbar: ViewModifier {
  @State private var isShowingDevices = false
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif

  func body(content: Content) -> some View {
    #if os(iOS)
      content
        .toolbar {
          ToolbarItem(placement: .topBarTrailing) {
            DeviceStatusButton(action: showDevices)
          }
          .visibilityPriority(.high)
          // The Devices button opens the same sheet as the status, so where the bar shares its
          // room with the tabs it is left out, and it is the first to give way on iPhone.
          if sizeClass != .regular {
            ToolbarItem(placement: .topBarTrailing) {
              Button(
                "Devices", systemImage: "antenna.radiowaves.left.and.right", action: showDevices)
            }
            .visibilityPriority(.low)
          }
        }
        .sheet(isPresented: $isShowingDevices) { DevicesSheet() }
    #else
      content
    #endif
  }

  private func showDevices() { isShowingDevices = true }
}
