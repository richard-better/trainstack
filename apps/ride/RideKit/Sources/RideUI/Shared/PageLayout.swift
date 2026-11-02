import SwiftUI

extension View {
  func pageLayout(
    maxWidth: Double = Design.pageWidth, alignment: HorizontalAlignment = .leading
  ) -> some View {
    padding(.horizontal, Design.pageMargin)
      .padding(.vertical, Design.pageVerticalMargin)
      .frame(maxWidth: maxWidth, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .center))
  }
}
