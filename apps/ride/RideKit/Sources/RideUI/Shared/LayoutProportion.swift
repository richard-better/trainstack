import SwiftUI

/// A subview's share of a `ProportionalRow`.
nonisolated struct LayoutProportion: LayoutValueKey {
  static let defaultValue = 1.0
}

extension View {
  /// The view's share of the width of the `ProportionalRow` it is in.
  func layoutProportion(_ proportion: Double) -> some View {
    layoutValue(key: LayoutProportion.self, value: proportion)
  }
}
