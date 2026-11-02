import SwiftUI

extension View {
  func inlineLinkStyle() -> some View {
    #if os(macOS)
      buttonStyle(.link)
    #else
      buttonStyle(InlineLinkButtonStyle())
    #endif
  }
}

#if os(iOS)
  private struct InlineLinkButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
      configuration.label
        .foregroundStyle(.tint)
        .opacity(configuration.isPressed ? 0.5 : 1)
        .minimumTapTarget()
    }
  }
#endif
