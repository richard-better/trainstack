import SwiftUI

public enum PrehabStyle {
  static let accent = Color(red: 0.75, green: 0.29, blue: 0.14)
  static let garden = Color(red: 0.29, green: 0.48, blue: 0.31)
  static func background(_ scheme: ColorScheme) -> Color {
    scheme == .dark
      ? Color(red: 0.05, green: 0.08, blue: 0.06) : Color(red: 0.96, green: 0.94, blue: 0.88)
  }
  static let space: CGFloat = 20
}

struct PrehabCard<Content: View>: View {
  @ViewBuilder var content: Content
  var body: some View {
    content.padding(PrehabStyle.space).frame(maxWidth: .infinity, alignment: .leading).background(
      .background.opacity(0.65), in: .rect(cornerRadius: 20))
  }
}
