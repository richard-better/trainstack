import SwiftUI

/// A legend entry that switches its series on and off, and lights up under the pointer.
struct LegendToggle: View {
  let title: String
  let color: Color
  let swatchHeight: Double
  let isShown: Bool
  let action: () -> Void
  @State private var isHovering = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        Rectangle().fill(color).frame(width: 12, height: swatchHeight)
        Text(title).strikethrough(!isShown)
      }
      .foregroundStyle(isHovering ? .primary : .secondary)
      .opacity(isShown ? 1 : 0.45)
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(.quaternary.opacity(isHovering ? 1 : 0), in: .rect(cornerRadius: 6))
      .contentShape(.rect(cornerRadius: 6))
      .minimumTapTarget()
    }
    .buttonStyle(.plain)
    .onHover { isHovering = $0 }
    #if os(macOS)
      .pointerStyle(.link)
    #endif
    .help(isShown ? "Hide \(title)" : "Show \(title)")
    .accessibilityLabel(title)
    .accessibilityValue(isShown ? "Shown" : "Hidden")
    .accessibilityAddTraits(.isToggle)
  }
}
