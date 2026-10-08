import SwiftUI

/// Lays out its subviews in rows, starting a new row when the next one does not fit.
struct FlowLayout: Layout {
  var horizontalSpacing = 12.0
  var verticalSpacing = 4.0

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = rows(in: proposal.width ?? .infinity, subviews: subviews)
    let width = rows.map(\.width).max() ?? 0
    let height = rows.map(\.height).reduce(0, +) + verticalSpacing * Double(max(rows.count - 1, 0))
    return CGSize(width: width, height: height)
  }

  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    var y = bounds.minY
    for row in rows(in: bounds.width, subviews: subviews) {
      var x = bounds.minX
      for index in row.indices {
        let size = subviews[index].sizeThatFits(.unspecified)
        subviews[index].place(
          at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: ProposedViewSize(size)
        )
        x += size.width + horizontalSpacing
      }
      y += row.height + verticalSpacing
    }
  }

  private struct Row {
    var indices: [Int] = []
    var width = 0.0
    var height = 0.0
  }

  private func rows(in maxWidth: Double, subviews: Subviews) -> [Row] {
    var rows: [Row] = []
    var row = Row()
    for index in subviews.indices {
      let size = subviews[index].sizeThatFits(.unspecified)
      let width = row.indices.isEmpty ? size.width : row.width + horizontalSpacing + size.width
      if width > maxWidth, !row.indices.isEmpty {
        rows.append(row)
        row = Row(indices: [index], width: size.width, height: size.height)
      } else {
        row.indices.append(index)
        row.width = width
        row.height = max(row.height, size.height)
      }
    }
    if !row.indices.isEmpty { rows.append(row) }
    return rows
  }
}
