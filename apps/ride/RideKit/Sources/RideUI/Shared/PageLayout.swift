import SwiftUI

extension View {
  /// Lays out a scrolling page's content with the app's margins, no wider than `maxWidth`,
  /// placed at `alignment` within the window.
  func pageLayout(
    maxWidth: Double = Design.pageWidth, alignment: HorizontalAlignment = .leading
  ) -> some View {
    padding(.horizontal, Design.pageMargin)
      .padding(.vertical, Design.pageVerticalMargin)
      .frame(maxWidth: maxWidth, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .center))
  }
}
