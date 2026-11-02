import SwiftUI

extension View {
  func minimumTapTarget() -> some View {
    #if os(iOS)
      frame(minWidth: 44, minHeight: 44).contentShape(.rect)
    #else
      self
    #endif
  }
}
