import SwiftUI

/// Lays out its subviews side by side across the width it is offered, each as wide as its share
/// of the row's total `layoutProportion`, with `spacing` between them.
struct ProportionalRow: Layout {
  var spacing = 0.0

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let height = subviews.map { $0.sizeThatFits(.unspecified).height }.max() ?? 0
    return CGSize(width: proposal.width ?? 0, height: proposal.height ?? height)
  }

  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    let total = subviews.reduce(0) { $0 + $1[LayoutProportion.self] }
    guard total > 0 else { return }
    let available = max(0, bounds.width - spacing * Double(max(subviews.count - 1, 0)))
    var x = bounds.minX
    for subview in subviews {
      let width = available * subview[LayoutProportion.self] / total
      subview.place(
        at: CGPoint(x: x, y: bounds.minY),
        proposal: ProposedViewSize(width: width, height: bounds.height))
      x += width + spacing
    }
  }
}
