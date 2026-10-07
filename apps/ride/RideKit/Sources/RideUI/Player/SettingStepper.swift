import SwiftUI

/// − value +, for the setting of the current trainer mode. The arrow keys work too.
struct SettingStepper: View {
  let label: String
  let decrease: () -> Void
  let increase: () -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    HStack(spacing: 0) {
      Button(action: decrease) {
        Label("Decrease", systemImage: "minus").minimumTapTarget()
      }
      .keyboardShortcut(.downArrow, modifiers: [])
      Text(label)
        .frame(minWidth: 64)
        .contentTransition(.numericText())
        .animation(reduceMotion ? nil : .default, value: label)
      Button(action: increase) {
        Label("Increase", systemImage: "plus").minimumTapTarget()
      }
      .keyboardShortcut(.upArrow, modifiers: [])
    }
    .labelStyle(.iconOnly)
    .buttonStyle(.borderless)
    .padding(.horizontal, 4)
    #if os(macOS)
      .frame(height: 32)
    #endif
    .glassEffect(.regular.interactive(), in: .capsule)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Trainer setting")
    .accessibilityValue(label)
    .accessibilityAdjustableAction { direction in
      switch direction {
      case .increment: increase()
      case .decrement: decrease()
      @unknown default: break
      }
    }
  }
}
