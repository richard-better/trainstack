import SwiftUI

/// A capsule filled from the leading edge to `fraction` of its width.
struct ProgressBar: View {
  let fraction: Double
  let color: Color

  var body: some View {
    Capsule()
      .fill(.quaternary.opacity(0.6))
      .frame(height: 8)
      .overlay {
        ProportionalRow {
          Capsule().fill(color).layoutProportion(fraction)
          Color.clear.layoutProportion(1 - fraction)
        }
      }
      .frame(maxWidth: .infinity)
  }
}
