import SwiftUI

extension View {
  /// Grows a button's label to Apple's minimum touch target of 44 points on iOS, keeping its
  /// look. Pointer-driven macOS keeps the label's own size.
  func minimumTapTarget() -> some View {
    #if os(iOS)
      frame(minWidth: 44, minHeight: 44).contentShape(.rect)
    #else
      self
    #endif
  }
}
