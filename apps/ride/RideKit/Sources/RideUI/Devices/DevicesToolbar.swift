import SwiftUI

extension View {
  /// The rider's devices at the trailing end of the navigation bar, each showing whether it is
  /// connected, and a Devices button. Any of them opens the Devices sheet. On iOS; macOS keeps
  /// Devices in Settings.
  func devicesToolbar() -> some View {
    modifier(DevicesToolbar())
  }
}

private struct DevicesToolbar: ViewModifier {
  @State private var isShowingDevices = false

  func body(content: Content) -> some View {
    #if os(iOS)
      content
        .toolbar {
          ToolbarItemGroup(placement: .topBarTrailing) {
            DeviceStatusButtons(showDevices: showDevices)
            Button("Devices", systemImage: "antenna.radiowaves.left.and.right", action: showDevices)
          }
        }
        .sheet(isPresented: $isShowingDevices) { DevicesSheet() }
    #else
      content
    #endif
  }

  private func showDevices() { isShowingDevices = true }
}
