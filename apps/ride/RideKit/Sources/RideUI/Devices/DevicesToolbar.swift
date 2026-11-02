import SwiftUI

extension View {
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
