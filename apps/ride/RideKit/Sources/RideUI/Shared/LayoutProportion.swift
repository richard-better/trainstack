import SwiftUI

nonisolated struct LayoutProportion: LayoutValueKey {
  static let defaultValue = 1.0
}

extension View {
  func layoutProportion(_ proportion: Double) -> some View {
    layoutValue(key: LayoutProportion.self, value: proportion)
  }
}
