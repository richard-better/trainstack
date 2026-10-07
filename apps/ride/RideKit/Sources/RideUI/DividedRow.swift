import SwiftUI

/// Stats side by side, sharing the width, with a rule between each.
struct DividedRow<Content: View>: View {
  /// The space either side of each rule.
  var spacing = 20.0
  @ViewBuilder let content: Content

  var body: some View {
    Group(subviews: content) { subviews in
      HStack(spacing: 0) {
        ForEach(subviews.enumerated(), id: \.element.id) { index, subview in
          subview
            .padding(.leading, index == 0 ? 0 : spacing)
            .overlay(alignment: .leading) {
              if index > 0 { Rectangle().fill(.separator).frame(width: 1) }
            }
        }
      }
    }
  }
}
