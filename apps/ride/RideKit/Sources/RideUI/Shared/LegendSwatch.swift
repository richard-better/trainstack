import SwiftUI

/// A legend entry: a block for an area, a short line for a line.
struct LegendSwatch: View {
  let title: String
  let fill: AnyShapeStyle
  let height: Double

  init(title: String, color: some ShapeStyle, height: Double) {
    self.title = title
    fill = AnyShapeStyle(color)
    self.height = height
  }

  var body: some View {
    HStack(spacing: 6) {
      RoundedRectangle(cornerRadius: height > 2 ? 2 : 0)
        .fill(fill)
        .frame(width: height > 2 ? 10 : 12, height: height)
      Text(title).lineLimit(1).fixedSize()
    }
  }
}
