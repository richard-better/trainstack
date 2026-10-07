import SwiftUI

extension View {
  /// A button that reads as a link within a sentence.
  func inlineLinkStyle() -> some View {
    #if os(macOS)
      buttonStyle(.link)
    #else
      buttonStyle(InlineLinkButtonStyle())
    #endif
  }
}

#if os(iOS)
  /// Tinted text like a link, with a touch target taller than the sentence around it.
  private struct InlineLinkButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
      configuration.label
        .foregroundStyle(.tint)
        .opacity(configuration.isPressed ? 0.5 : 1)
        .minimumTapTarget()
    }
  }
#endif
